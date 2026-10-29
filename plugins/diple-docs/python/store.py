"""Diple Docs backend storage: the plugin's own SQLite (ADR 0005).

Loaded twice like the Diple store (package import from the agent hooks + by
path from dashboard/plugin_api.py); the two instances share data only through
SQLite.

The review list (标注清单) lives here, keyed by document path. This module is
the single authority for an item's lifecycle:

    pending ──(batch.sent, same revision)──▶ sent ──(batch.answered, same revision)──▶ answered
       ▲                                                                                 │
       └──── comment edited / original replaced / reopened (revision + 1) ◀──────────────┘
    any ──(user)──▶ resolved ──(user: reopen)──▶ pending

"原文已变" (changed) is a flag (``lost``) on top of the lifecycle status: the
page sets it when the Anchor can no longer be found, and clears it when the
text is found again, so the item returns to where it was.
"""

from __future__ import annotations

import errno
import json
import os
import re
import sqlite3
import stat as stat_mod
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

PLUGIN_ID = "diple-docs"
REVIEW_SUFFIXES = (".md", ".markdown")
HANDOFF_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{4,128}$")
ITEM_ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TEXT_CHARS = 200_000
MAX_COMMENT_CHARS = 20_000
ITEM_STATUSES = ("pending", "sent", "answered", "resolved", "changed")
LIFECYCLE = ("pending", "sent", "answered", "resolved")
TURN_WRITE_TTL = 6 * 3600
DEFAULT_SETTINGS = {"autoCard": True}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS reviews (
    path           TEXT PRIMARY KEY,
    last_opened_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
    id                 TEXT PRIMARY KEY,
    path               TEXT NOT NULL,
    anchor_json        TEXT NOT NULL,
    text               TEXT NOT NULL,
    comment            TEXT NOT NULL DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'pending',
    revision           INTEGER NOT NULL DEFAULT 1,
    sent_sessions_json TEXT NOT NULL DEFAULT '[]',
    created_at         REAL NOT NULL,
    updated_at         REAL NOT NULL,
    lost               INTEGER NOT NULL DEFAULT 0,
    queued_json        TEXT,
    mutation           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS items_path ON items(path);
CREATE TABLE IF NOT EXISTS handoffs (
    handoff_id   TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    created_at   REAL NOT NULL,
    receipt_json TEXT,
    cancelled_at REAL
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turn_writes (
    session_id TEXT NOT NULL,
    turn_id    TEXT NOT NULL,
    path       TEXT NOT NULL,
    at         REAL NOT NULL,
    PRIMARY KEY (session_id, turn_id, path)
);
"""

# Columns added after the W1 schema shipped to sandboxes (idempotent upgrades).
_UPGRADES = (
    ("items", "lost", "INTEGER NOT NULL DEFAULT 0"),
    ("items", "queued_json", "TEXT"),
    ("handoffs", "cancelled_at", "REAL"),
    ("items", "mutation", "INTEGER NOT NULL DEFAULT 1"),
    ("handoffs", "settled_json", "TEXT"),
)


def is_review_path(path: Any) -> bool:
    """THE suffix rule (XR1-09): open, recent reviews, auto card and refresh all call this."""
    return isinstance(path, str) and path.lower().endswith(REVIEW_SUFFIXES)


def valid_handoff_id(handoff_id: Any) -> bool:
    return isinstance(handoff_id, str) and bool(HANDOFF_ID_RE.fullmatch(handoff_id))


def valid_item_id(item_id: Any) -> bool:
    return isinstance(item_id, str) and bool(ITEM_ID_RE.fullmatch(item_id))


def item_outcomes(settled: Any, item_ids: Any) -> list[dict]:
    """Twin of handoff-protocol.js itemOutcomes (R5; same cases and differential test):
    each handed-over item's final word [{itemId, delivered, reason?}], in ``item_ids``
    order. An item counts as delivered only when the hand-off was; with a per-item list
    its own entry decides (missing from a list that exists: not sent, 'unlisted')."""
    s = settled if isinstance(settled, dict) else {}
    top = s.get("delivered") is True
    top_reason = s["reason"] if isinstance(s.get("reason"), str) and s["reason"] else None
    listed: Optional[dict] = None
    if isinstance(s.get("items"), list):
        listed = {}
        for x in s["items"]:
            if isinstance(x, dict) and isinstance(x.get("itemId"), str) and isinstance(x.get("delivered"), bool) \
                    and x["itemId"] not in listed:
                listed[x["itemId"]] = x
    out = []
    for item_id in item_ids if isinstance(item_ids, list) else []:
        if not isinstance(item_id, str):
            continue
        if listed is not None:
            w = listed.get(item_id)
            if w is None:
                out.append({"itemId": item_id, "delivered": False, "reason": "unlisted"})
                continue
            if top and w["delivered"]:
                out.append({"itemId": item_id, "delivered": True})
                continue
            why = w["reason"] if isinstance(w.get("reason"), str) and w["reason"] else top_reason
            out.append({"itemId": item_id, "delivered": False, **({"reason": why} if why else {})})
        elif top:
            out.append({"itemId": item_id, "delivered": True})
        else:
            out.append({"itemId": item_id, "delivered": False, **({"reason": top_reason} if top_reason else {})})
    return out


class ReviewFileError(Exception):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code, self.status = code, status


class ItemError(Exception):
    """A rejected item operation; ``code`` is a stable machine id the UI translates."""

    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code, self.status = code, status


# Credential folders under the user's home and the Hermes home (mirrors the host's
# agent/context_references.py + agent/file_safety.py deny-lists; the host check is
# consulted too when it can be imported, see _host_read_blocked).
_HOME_CREDENTIAL_DIRS = (".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", ".config/gh", ".config/gcloud")
_HERMES_DENIED_DIRS = ("skills/.hub", "mcp-tokens", "browser-profile", "vault", "auth")
_HERMES_DENIED_FILES = ("auth.json", "auth.lock", ".anthropic_oauth.json", ".env", "webhook_subscriptions.json",
                        "cache/bws_cache.json")


def _under(p: Path, base: Path) -> bool:
    try:
        p.relative_to(base)
        return True
    except ValueError:
        return False


def _hermes_dirs() -> list[Path]:
    out = []
    try:
        from hermes_constants import get_hermes_home

        out.append(Path(get_hermes_home()))
    except Exception:
        pass
    out.append(Path.home() / ".hermes")
    return list(dict.fromkeys(Path(os.path.realpath(d)) for d in out))


def _host_read_blocked(real: str) -> bool:
    """The host's canonical read deny-list (agent.file_safety). Fails closed only when the check itself breaks."""
    try:
        from agent.file_safety import get_read_block_error
    except Exception:
        return False  # not running inside the host (unit tests without it): our own list applies
    try:
        return get_read_block_error(real) is not None
    except Exception:
        return True


def _sensitive_places() -> tuple[list[Path], list[Path]]:
    """(denied folders, denied files) as real paths."""
    home = Path(os.path.realpath(Path.home()))
    dirs = [Path(os.path.realpath(home / d)) for d in _HOME_CREDENTIAL_DIRS]
    files: list[Path] = []
    for hd in _hermes_dirs():
        dirs += [Path(os.path.realpath(hd / d)) for d in _HERMES_DENIED_DIRS]
        files += [Path(os.path.realpath(hd / f)) for f in _HERMES_DENIED_FILES]
    return list(dict.fromkeys(dirs)), list(dict.fromkeys(files))


def is_sensitive_path(real: str) -> bool:
    """Credential stores and internal Hermes folders are never shown, whatever their suffix."""
    p = Path(real)
    dirs, files = _sensitive_places()
    if any(_under(p, d) for d in dirs) or any(p == f for f in files):
        return True
    return _host_read_blocked(real)


def _identities(paths: Iterable[Path]) -> set[tuple[int, int]]:
    out = set()
    for p in paths:
        try:
            st = os.stat(p)
        except OSError:
            continue
        out.add((st.st_dev, st.st_ino))
    return out


# Test seam (XR-01): called with the canonical path after every path-level check
# and before the first directory is opened — the window a concurrent rename races in.
_between_check_and_open: Optional[Callable[[str], None]] = None

_O_CLOEXEC = getattr(os, "O_CLOEXEC", 0)
_O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | _O_NOFOLLOW | _O_CLOEXEC
_FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | _O_NOFOLLOW | _O_CLOEXEC


def _open_step(name: str, flags: int, dir_fd: int) -> int:
    """openat(dir_fd, name, flags|O_NOFOLLOW): a symlink here means the tree changed since realpath."""
    try:
        return os.open(name, flags, dir_fd=dir_fd)
    except FileNotFoundError:
        raise ReviewFileError("not-found", 404)
    except OSError as exc:
        try:
            if stat_mod.S_ISLNK(os.stat(name, dir_fd=dir_fd, follow_symlinks=False).st_mode):
                raise ReviewFileError("path-changed", 409)
        except OSError:
            pass
        if exc.errno == errno.ELOOP:
            raise ReviewFileError("path-changed", 409)
        raise ReviewFileError("not-found", 404)


def open_review_file(path: str) -> int:
    """THE file-read authorisation (XR-01): returns an fd the caller owns, or raises ReviewFileError.

    Authorising and opening are one step, so what was checked is what is read:

    1. the path the user gave must be absolute and carry the suffix;
    2. it is resolved once (realpath) to a canonical path, whose name must carry
       the suffix too and which must lie outside every credential place
       (our list + the host's ``agent.file_safety`` checkpoint);
    3. the canonical path is opened one component at a time from ``/``, every
       folder with ``openat(parent_fd, name, O_DIRECTORY|O_NOFOLLOW)``. The
       canonical path holds no symlinks, so meeting one means the tree changed
       after the check: ``path-changed`` (409). Every folder fd is fstat-ed and
       compared with the (st_dev, st_ino) of every denied folder, so a denied
       folder moved or swapped into the path is still refused;
    4. the file is opened from its parent fd with O_NOFOLLOW|O_NONBLOCK and must
       be a regular file (``not-regular``), not a denied file by identity, and
       have exactly one name — ``st_nlink > 1`` is ``hardlinked`` (415): a hard
       link is an alias no path check can see.
    """
    if not isinstance(path, str) or not path.strip():
        raise ReviewFileError("path-required", 400)
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise ReviewFileError("path-not-absolute", 400)
    if not is_review_path(p.name):
        raise ReviewFileError("unsupported-suffix", 415)
    deny_dirs, deny_files = _sensitive_places()
    dir_ids, file_ids = _identities(deny_dirs), _identities(deny_files)
    canonical = Path(os.path.realpath(p))
    if not is_review_path(canonical.name):
        raise ReviewFileError("unsupported-suffix", 415)
    if is_sensitive_path(str(canonical)) or is_sensitive_path(os.path.normpath(str(p))):
        raise ReviewFileError("sensitive-path", 403)
    if _between_check_and_open is not None:
        _between_check_and_open(str(canonical))

    parts = canonical.parts
    fd = os.open(parts[0], _DIR_FLAGS)
    try:
        for name in (*parts[1:-1], None):
            st = os.fstat(fd)
            if (st.st_dev, st.st_ino) in dir_ids:
                raise ReviewFileError("sensitive-path", 403)
            if name is None:
                break
            nxt = _open_step(name, _DIR_FLAGS, fd)
            os.close(fd)
            fd = nxt
        file_fd = _open_step(parts[-1], _FILE_FLAGS, fd)
    finally:
        os.close(fd)
    try:
        st = os.fstat(file_fd)
        if (st.st_dev, st.st_ino) in file_ids or (st.st_dev, st.st_ino) in dir_ids:
            raise ReviewFileError("sensitive-path", 403)
        if not stat_mod.S_ISREG(st.st_mode):
            raise ReviewFileError("not-regular", 415)
        if st.st_nlink > 1:
            raise ReviewFileError("hardlinked", 415)
    except BaseException:
        os.close(file_fd)
        raise
    return file_fd


def stat_review_file(path: str, max_bytes: Optional[int] = None) -> os.stat_result:
    """fstat of the authorised file (the 2 s poll): same checks as a read, nothing read."""
    fd = open_review_file(path)
    try:
        st = os.fstat(fd)
    finally:
        os.close(fd)
    if st.st_size > (MAX_FILE_BYTES if max_bytes is None else max_bytes):
        raise ReviewFileError("too-large", 413)
    return st


def read_review_file(path: str, max_bytes: Optional[int] = None) -> tuple[str, os.stat_result]:
    """Read an authorised document through the fd open_review_file returned.

    Read to at most the cap + 1 byte (a file that grew past the cap is refused,
    not truncated). Newlines are normalised like Python's text mode.
    """
    cap = MAX_FILE_BYTES if max_bytes is None else max_bytes
    fd = open_review_file(path)
    try:
        st = os.fstat(fd)
        if st.st_size > cap:
            raise ReviewFileError("too-large", 413)
        chunks, total = [], 0
        while total <= cap:
            chunk = os.read(fd, min(1 << 20, cap + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
    finally:
        os.close(fd)
    if total > cap:
        raise ReviewFileError("too-large", 413)
    try:
        text = b"".join(chunks).decode("utf-8")
    except UnicodeDecodeError:
        raise ReviewFileError("not-utf8", 415)
    return text.replace("\r\n", "\n").replace("\r", "\n"), st


def normalize_path(path: str) -> str:
    """The key a document's review list is stored under (absolute, ~ expanded, no symlink games)."""
    return str(Path(path).expanduser())


def clean_anchor(anchor: Any) -> dict:
    if not isinstance(anchor, dict):
        raise ItemError("anchor-required")
    text = anchor.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ItemError("anchor-required")
    if len(text) > MAX_TEXT_CHARS:
        raise ItemError("text-too-long", 413)
    line = anchor.get("line")
    out = {
        "text": text,
        "before": str(anchor.get("before") or "")[:200],
        "after": str(anchor.get("after") or "")[:200],
        "line": int(line) if isinstance(line, (int, float)) and line >= 1 else 1,
    }
    sig = anchor.get("sig")
    if isinstance(sig, str) and 0 < len(sig) <= 64:
        out["sig"] = sig  # fingerprint of the document version the anchor was taken in (XR-05)
    return out


def clean_comment(comment: Any) -> str:
    if comment is None:
        return ""
    if not isinstance(comment, str):
        raise ItemError("comment-invalid")
    if len(comment) > MAX_COMMENT_CHARS:
        raise ItemError("comment-too-long", 413)
    return comment


def _default_connect() -> sqlite3.Connection:
    from plugins.plugin_storage import plugin_db

    return plugin_db(PLUGIN_ID)


class ReviewStore:
    def __init__(self, connect: Callable[[], sqlite3.Connection] = _default_connect,
                 clock: Callable[[], float] = time.time,
                 new_id: Callable[[], str] = lambda: "r" + uuid.uuid4().hex[:15]) -> None:
        self._conn = connect()
        self._conn.row_factory = sqlite3.Row
        self._clock = clock
        self._new_id = new_id
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(_SCHEMA)
            for table, column, decl in _UPGRADES:
                cols = {r[1] for r in self._conn.execute(f"PRAGMA table_info({table})")}
                if column not in cols:
                    self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
            self._conn.commit()

    def _now(self) -> float:
        return float(self._clock())

    # -- reviews ---------------------------------------------------------------
    def touch_review(self, path: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO reviews (path, last_opened_at) VALUES (?, ?) "
                "ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at",
                (path, self._now()),
            )
            self._conn.commit()

    def recent_reviews(self, limit: int = 20) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT r.path, r.last_opened_at, "
                "  (SELECT COUNT(*) FROM items i WHERE i.path = r.path AND i.status != 'resolved') AS open_items, "
                "  (SELECT COUNT(*) FROM items i WHERE i.path = r.path) AS all_items "
                "FROM reviews r ORDER BY r.last_opened_at DESC LIMIT ?",
                (max(1, min(int(limit), 200)),),
            ).fetchall()
        return [{"path": r["path"], "lastOpenedAt": r["last_opened_at"], "openItems": r["open_items"],
                 "items": r["all_items"]} for r in rows if is_review_path(r["path"])]

    def forget_review(self, path: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM reviews WHERE path = ?", (path,))
            self._conn.commit()

    # -- items -------------------------------------------------------------------
    @staticmethod
    def _item(row: Any) -> dict:
        status = row["status"] if row["status"] in LIFECYCLE else "pending"
        return {
            "id": row["id"],
            "path": row["path"],
            "anchor": json.loads(row["anchor_json"]),
            "text": row["text"],
            "comment": row["comment"],
            "status": status,
            "lost": bool(row["lost"]),
            "revision": row["revision"],
            "mutation": row["mutation"],
            "sentSessions": json.loads(row["sent_sessions_json"] or "[]"),
            "queued": json.loads(row["queued_json"]) if row["queued_json"] else None,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    def _get_row(self, item_id: str) -> Optional[sqlite3.Row]:
        return self._conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()

    def list_items(self, path: str) -> list[dict]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM items WHERE path = ? ORDER BY created_at ASC", (path,)).fetchall()
        return [self._item(r) for r in rows]

    def item_counts(self, paths: Iterable[str]) -> dict:
        """Per-path counts for the transcript cards (V3-D2): one read for many lists.

        ``open`` is everything not resolved — the number a card shows.
        """
        keys = list(dict.fromkeys(paths))
        out = {k: {"total": 0, "open": 0, "byStatus": {s: 0 for s in LIFECYCLE}, "lost": 0, "itemsVersion": "0:0"}
               for k in keys}
        if not keys:
            return out
        marks = ",".join("?" * len(keys))
        with self._lock:
            rows = self._conn.execute(
                f"SELECT path, status, COUNT(*) AS n, SUM(lost) AS lost, MAX(updated_at) AS u "
                f"FROM items WHERE path IN ({marks}) GROUP BY path, status", keys).fetchall()
        newest: dict[str, float] = {}
        for r in rows:
            c = out[r["path"]]
            status = r["status"] if r["status"] in LIFECYCLE else "pending"
            c["byStatus"][status] += r["n"]
            c["total"] += r["n"]
            c["lost"] += int(r["lost"] or 0)
            if status != "resolved":
                c["open"] += r["n"]
            newest[r["path"]] = max(newest.get(r["path"], 0), r["u"] or 0)
        for k, c in out.items():
            c["itemsVersion"] = f"{c['total']}:{newest.get(k, 0)}"
        return out

    def get_item(self, item_id: str) -> Optional[dict]:
        with self._lock:
            row = self._get_row(item_id)
        return self._item(row) if row else None

    def items_version(self, path: str) -> str:
        with self._lock:
            r = self._conn.execute("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM items WHERE path = ?",
                                   (path,)).fetchone()
        return f"{r['n']}:{r['u'] or 0}"

    def add_item(self, path: str, anchor: Any, comment: Any = "") -> dict:
        """Add an annotation. The same original at the same line is a duplicate: the existing item comes back."""
        if not is_review_path(path):
            raise ItemError("unsupported-suffix", 415)
        a = clean_anchor(anchor)
        c = clean_comment(comment)
        now = self._now()
        with self._lock:
            dup = self._conn.execute(
                "SELECT * FROM items WHERE path = ? AND text = ? AND json_extract(anchor_json, '$.line') = ?",
                (path, a["text"], a["line"]),
            ).fetchone()
            if dup is not None:
                return {**self._item(dup), "duplicate": True}
            item_id = self._new_id()
            self._conn.execute(
                "INSERT INTO items (id, path, anchor_json, text, comment, status, revision, sent_sessions_json, "
                "created_at, updated_at, lost) VALUES (?, ?, ?, ?, ?, 'pending', 1, '[]', ?, ?, 0)",
                (item_id, path, json.dumps(a, ensure_ascii=False), a["text"], c, now, now),
            )
            self._conn.commit()
            row = self._get_row(item_id)
        return {**self._item(row), "duplicate": False}

    def update_item(self, item_id: str, op: str, *, comment: Any = None, anchor: Any = None,
                    expect_revision: Any = None, expect_mutation: Any = None) -> dict:
        """User operations: ``comment`` | ``replace`` | ``resolve`` | ``reopen``.

        Two version numbers (XR-04 / XR2-01):

        - ``revision`` is the CONTENT version the Diple plugin carries in
          ``origin.revision`` (comment / original / reopen move it); a late
          sent/answered event for an older revision never touches a newer one.
        - ``mutation`` moves on EVERY user operation, resolve included, and
          nothing else (events from Diple and relocations leave it alone).
          ``expect_mutation`` rejects an edit made against a stale copy with
          ``stale`` (409): an editor opened before another window resolved the
          item cannot silently undo that.

        ``expect_revision`` is still honoured for older pages.
        """
        with self._lock:
            row = self._get_row(item_id)
            if row is None:
                raise ItemError("unknown-item", 404)
            if expect_revision is not None and int(expect_revision) != row["revision"]:
                raise ItemError("stale", 409)
            if expect_mutation is not None and int(expect_mutation) != row["mutation"]:
                raise ItemError("stale", 409)
            status, revision, mutation = row["status"], row["revision"], row["mutation"]
            sets: dict[str, Any] = {}
            if op == "comment":
                c = clean_comment(comment)
                if c == row["comment"]:
                    return self._item(row)
                sets = {"comment": c}
                if status != "pending" or row["queued_json"]:
                    sets.update(status="pending", revision=revision + 1, queued_json=None)
                else:
                    sets.update(revision=revision + 1)
            elif op == "replace":
                a = clean_anchor(anchor)
                sets = {"anchor_json": json.dumps(a, ensure_ascii=False), "text": a["text"], "lost": 0,
                        "status": "pending", "revision": revision + 1, "queued_json": None}
            elif op == "resolve":
                if status == "resolved":
                    return self._item(row)
                sets = {"status": "resolved", "queued_json": None}
            elif op == "reopen":
                if status != "resolved":
                    return self._item(row)
                sets = {"status": "pending", "revision": revision + 1}
            else:
                raise ItemError("unknown-op")
            sets["updated_at"] = self._now()
            sets["mutation"] = mutation + 1
            cols = ", ".join(f"{k} = ?" for k in sets)
            # the versions we decided on are part of the write: a writer that slipped in between loses nothing
            cur = self._conn.execute(f"UPDATE items SET {cols} WHERE id = ? AND revision = ? AND mutation = ?",
                                     (*sets.values(), item_id, revision, mutation))
            if cur.rowcount == 0:
                self._conn.rollback()
                raise ItemError("stale", 409)
            self._conn.commit()
            row = self._get_row(item_id)
        return self._item(row)

    def delete_item(self, item_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
            self._conn.commit()
        return cur.rowcount > 0

    def restore_item(self, item: dict) -> dict:
        """Undo a delete: put the item back exactly as it was (same id)."""
        if not valid_item_id(item.get("id")) or not is_review_path(item.get("path")):
            raise ItemError("invalid-item")
        a = clean_anchor(item.get("anchor"))
        status = item.get("status") if item.get("status") in LIFECYCLE else "pending"
        now = self._now()
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO items (id, path, anchor_json, text, comment, status, revision, "
                "sent_sessions_json, created_at, updated_at, lost, queued_json, mutation) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (item["id"], item["path"], json.dumps(a, ensure_ascii=False), a["text"],
                 clean_comment(item.get("comment")), status, int(item.get("revision") or 1),
                 json.dumps(item.get("sentSessions") or [], ensure_ascii=False),
                 float(item.get("createdAt") or now), now, 1 if item.get("lost") else 0,
                 json.dumps(item["queued"], ensure_ascii=False) if item.get("queued") else None,
                 max(1, int(item.get("mutation") or 1))),
            )
            self._conn.commit()
            row = self._get_row(item["id"])
        return self._item(row)

    # -- bulk (V3-D2): one transaction each; every named item, or none ----------
    def _rows_for(self, path: str, ids: Any, expect: Any = None) -> list[sqlite3.Row]:
        """The rows of ``ids`` in ``path``; ``stale`` (409) when one is gone, elsewhere or edited since."""
        if not isinstance(ids, list) or not all(valid_item_id(i) for i in ids):
            raise ItemError("invalid-item")
        expect = expect if isinstance(expect, dict) else {}
        rows = []
        for item_id in dict.fromkeys(ids):
            row = self._get_row(item_id)
            if row is None or row["path"] != path:
                raise ItemError("stale", 409)
            want = expect.get(item_id)
            if want is not None and int(want) != row["mutation"]:
                raise ItemError("stale", 409)
            rows.append(row)
        return rows

    def delete_items(self, path: str, ids: Any, expect_mutations: Any = None) -> list[dict]:
        """Clear several items of one list; returns their snapshots (for ``restore_items``).

        What was already sent is not touched: hand-offs and the chat keep their copies."""
        with self._lock:
            try:
                rows = self._rows_for(path, ids, expect_mutations)
                for row in rows:
                    self._conn.execute("DELETE FROM items WHERE id = ?", (row["id"],))
                self._conn.commit()
            except BaseException:
                self._conn.rollback()
                raise
        return [self._item(r) for r in rows]

    def _restore_values(self, item: Any, now: float) -> tuple:
        if not isinstance(item, dict) or not valid_item_id(item.get("id")) or not is_review_path(item.get("path")):
            raise ItemError("invalid-item")
        a = clean_anchor(item.get("anchor"))
        status = item.get("status") if item.get("status") in LIFECYCLE else "pending"
        return (item["id"], item["path"], json.dumps(a, ensure_ascii=False), a["text"],
                clean_comment(item.get("comment")), status, int(item.get("revision") or 1),
                json.dumps(item.get("sentSessions") or [], ensure_ascii=False),
                float(item.get("createdAt") or now), now, 1 if item.get("lost") else 0,
                json.dumps(item["queued"], ensure_ascii=False) if item.get("queued") else None,
                max(1, int(item.get("mutation") or 1)))

    def restore_items(self, items: Any) -> list[dict]:
        """Undo a bulk clear: every item back exactly as it was (same ids), or none."""
        if not isinstance(items, list):
            raise ItemError("invalid-item")
        now = self._now()
        values = [self._restore_values(it, now) for it in items]  # validate all before writing any
        with self._lock:
            try:
                for v in values:
                    self._conn.execute(
                        "INSERT OR IGNORE INTO items (id, path, anchor_json, text, comment, status, revision, "
                        "sent_sessions_json, created_at, updated_at, lost, queued_json, mutation) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", v)
                self._conn.commit()
            except BaseException:
                self._conn.rollback()
                raise
            rows = [self._get_row(v[0]) for v in values]
        return [self._item(r) for r in rows if r is not None]

    def resolve_items(self, path: str, ids: Any, expect_mutations: Any = None) -> list[str]:
        """Mark several items 已解决 (a user operation: their ``mutation`` moves); returns the ids that changed."""
        now = self._now()
        with self._lock:
            try:
                rows = self._rows_for(path, ids, expect_mutations)
                changed = []
                for row in rows:
                    if row["status"] == "resolved":
                        continue
                    self._conn.execute("UPDATE items SET status = 'resolved', queued_json = NULL, updated_at = ?, "
                                       "mutation = mutation + 1 WHERE id = ?", (now, row["id"]))
                    changed.append(row["id"])
                self._conn.commit()
            except BaseException:
                self._conn.rollback()
                raise
        return changed

    def apply_locations(self, path: str, results: Iterable[Any]) -> int:
        """Store what the page's Anchor pass found: a refreshed anchor, or ``lost``.

        Only real changes touch ``updated_at``, so two windows agreeing on the
        same result do not ping-pong refreshes.
        """
        changed = 0
        now = self._now()
        with self._lock:
            for r in results:
                if not isinstance(r, dict) or not valid_item_id(r.get("id")):
                    continue
                row = self._conn.execute("SELECT * FROM items WHERE id = ? AND path = ?", (r["id"], path)).fetchone()
                if row is None:
                    continue
                if r.get("lost"):
                    if not row["lost"]:
                        self._conn.execute("UPDATE items SET lost = 1, updated_at = ? WHERE id = ?", (now, r["id"]))
                        changed += 1
                    continue
                try:
                    a = clean_anchor(r.get("anchor"))
                except ItemError:
                    continue
                if a["text"] != row["text"]:
                    continue  # a relocation never changes the original; that is ``replace``
                old = json.loads(row["anchor_json"])
                if old != a or row["lost"]:
                    self._conn.execute("UPDATE items SET anchor_json = ?, lost = 0, updated_at = ? WHERE id = ?",
                                       (json.dumps(a, ensure_ascii=False), now, r["id"]))
                    changed += 1
            self._conn.commit()
        return changed

    # -- events from the Diple plugin -------------------------------------------
    @staticmethod
    def _review_origins(entries: Any) -> list[dict]:
        out = []
        for e in entries if isinstance(entries, list) else []:
            o = (e or {}).get("origin") if isinstance(e, dict) else None
            if isinstance(o, dict) and o.get("plugin") == PLUGIN_ID and valid_item_id(o.get("itemId")):
                out.append(o)
        return out

    def _failed_in(self, batch_id: str) -> set[str]:
        """Items of a hand-off whose REAL final word for this batch is "not delivered"
        (ADR 0007 §3): an intermediate event of that batch arriving late never moves
        them again. Inside the lock."""
        if not batch_id:
            return set()
        rows = self._conn.execute(
            "SELECT payload, receipt_json FROM handoffs WHERE settled_json IS NOT NULL "
            "AND json_extract(settled_json, '$.delivered') = 0 AND json_extract(settled_json, '$.inferred') IS NULL "
            "AND (json_extract(settled_json, '$.batchId') = ? OR json_extract(receipt_json, '$.batchId') = ?)",
            (batch_id, batch_id),
        ).fetchall()
        out: set[str] = set()
        for r in rows:
            receipt = json.loads(r["receipt_json"]) if r["receipt_json"] else None
            if receipt and isinstance(receipt.get("accepted"), list):
                out.update(x for x in receipt["accepted"] if isinstance(x, str))
            else:
                for it in json.loads(r["payload"]).get("items") or []:
                    o = (it or {}).get("origin") or {}
                    if isinstance(o.get("itemId"), str):
                        out.add(o["itemId"])
        return out

    def apply_sent(self, payload: Any) -> list[str]:
        """``plugin.diple.batch.sent``: record the session; pending → sent when the revision still matches.
        Not for items whose hand-off already settled this batch as not delivered (XR3-01)."""
        if not isinstance(payload, dict):
            return []
        batch_id = str(payload.get("batchId") or "")
        session_id = str(payload.get("sessionId") or "")
        now = self._now()
        touched = []
        with self._lock:
            failed = self._failed_in(batch_id)
            for o in self._review_origins(payload.get("items")):
                row = self._get_row(o["itemId"])
                if row is None or row["id"] in failed:
                    continue
                sessions = json.loads(row["sent_sessions_json"] or "[]")
                sets: dict[str, Any] = {}
                if session_id and not any(s.get("batchId") == batch_id for s in sessions):
                    sessions.append({"sessionId": session_id, "batchId": batch_id, "at": now,
                                     "revision": o.get("revision")})
                    sets["sent_sessions_json"] = json.dumps(sessions, ensure_ascii=False)
                if o.get("revision") == row["revision"] and row["status"] == "pending":
                    sets.update(status="sent", queued_json=None)
                if sets:
                    sets["updated_at"] = now
                    cols = ", ".join(f"{k} = ?" for k in sets)
                    self._conn.execute(f"UPDATE items SET {cols} WHERE id = ?", (*sets.values(), row["id"]))
                    touched.append(row["id"])
            self._conn.commit()
        return touched

    def apply_answered(self, payload: Any) -> list[str]:
        """``plugin.diple.batch.answered``: pending|sent → answered, only for the same revision.

        A late answer to an older revision never overwrites a newer edit, and
        ``resolved`` is only ever set or cleared by the user.
        """
        if not isinstance(payload, dict):
            return []
        now = self._now()
        touched = []
        with self._lock:
            failed = self._failed_in(str(payload.get("batchId") or ""))
            for o in self._review_origins(payload.get("answered")):
                row = self._get_row(o["itemId"])
                if row is None or row["id"] in failed or o.get("revision") != row["revision"] or row["status"] not in ("pending", "sent"):
                    continue
                self._conn.execute("UPDATE items SET status = 'answered', queued_json = NULL, updated_at = ? "
                                   "WHERE id = ?", (now, row["id"]))
                touched.append(row["id"])
            self._conn.commit()
        return touched

    # -- hand-offs -------------------------------------------------------------
    @staticmethod
    def _handoff(row: Optional[sqlite3.Row]) -> Any:
        if row is None:
            return None
        return {
            "handoffId": row["handoff_id"],
            "payload": json.loads(row["payload"]),
            "createdAt": row["created_at"],
            "receipt": json.loads(row["receipt_json"]) if row["receipt_json"] else None,
            "cancelledAt": row["cancelled_at"],
            "settled": json.loads(row["settled_json"]) if row["settled_json"] else None,
        }

    def save_handoff(self, payload: dict) -> dict:
        handoff_id = payload.get("handoffId")
        if not valid_handoff_id(handoff_id):
            raise ValueError("invalid handoff id")
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO handoffs (handoff_id, payload, created_at) VALUES (?, ?, ?)",
                (handoff_id, json.dumps(payload, ensure_ascii=False), self._now()),
            )
            self._conn.commit()
            row = self._conn.execute("SELECT * FROM handoffs WHERE handoff_id = ?", (handoff_id,)).fetchone()
        return self._handoff(row)

    def get_handoff(self, handoff_id: str) -> Any:
        if not valid_handoff_id(handoff_id):
            return None
        with self._lock:
            row = self._conn.execute("SELECT * FROM handoffs WHERE handoff_id = ?", (handoff_id,)).fetchone()
        return self._handoff(row)

    def record_receipt(self, handoff_id: str, receipt: dict) -> Any:
        """Store the first receipt (later ones are ignored) and mark accepted items as queued.

        A receipt that arrives after the sender gave up (cancelled) still
        counts: the receiver did take the items. A receipt that arrives after
        the hand-off's settled is only stored: the final word already placed
        the items (XR3-01, ADR 0007 §3).
        """
        now = self._now()
        with self._lock:
            row = self._conn.execute("SELECT * FROM handoffs WHERE handoff_id = ?", (handoff_id,)).fetchone()
            if row is None:
                return None
            if row["receipt_json"] is None:
                self._conn.execute("UPDATE handoffs SET receipt_json = ? WHERE handoff_id = ?",
                                   (json.dumps(receipt, ensure_ascii=False), handoff_id))
            if row["receipt_json"] is None and row["settled_json"] is None:
                payload = json.loads(row["payload"])
                accepted = set(receipt.get("accepted") or []) if isinstance(receipt, dict) else set()
                for it in payload.get("items") or []:
                    o = (it or {}).get("origin") or {}
                    if o.get("itemId") not in accepted:
                        continue
                    item = self._get_row(o["itemId"])
                    if item is None or item["revision"] != o.get("revision") or item["status"] != "pending":
                        continue
                    queued = {"sessionId": payload.get("targetSessionId") or "", "revision": item["revision"],
                              "at": now, "sendNow": bool(payload.get("sendNow"))}
                    batch_id = receipt.get("batchId") if isinstance(receipt, dict) else None
                    if isinstance(batch_id, str) and batch_id:
                        queued["batchId"] = batch_id  # submitted, waiting for plugin.diple.handoff.settled (XR-09)
                    self._conn.execute("UPDATE items SET queued_json = ?, updated_at = ? WHERE id = ?",
                                       (json.dumps(queued, ensure_ascii=False), now, item["id"]))
            self._conn.commit()
            row = self._conn.execute("SELECT * FROM handoffs WHERE handoff_id = ?", (handoff_id,)).fetchone()
        return self._handoff(row)

    def record_settled(self, handoff_id: str, settled: dict) -> tuple[Any, list[str]]:
        """``plugin.diple.handoff.settled``: the FINAL result of a hand-off's send (XR-09).

        Stored once (an ``inferred`` one — concluded by the page from batch.answered /
        batch.sent when Diple never sends settled — gives way to a real one). ``delivered`` true marks the handed-over items sent (also
        when batch.sent never reached us); false puts them back to pending —
        they are back in the session's pending list — and drops the session
        entry of that batch. Only items still at the handed-over revision, and
        never an answered or resolved one, are touched. Returns (hand-off, touched).
        """
        now = self._now()
        touched: list[str] = []
        with self._lock:
            row = self._conn.execute("SELECT * FROM handoffs WHERE handoff_id = ?", (handoff_id,)).fetchone()
            if row is None:
                return None, []
            prev = json.loads(row["settled_json"]) if row["settled_json"] else None
            receipt0 = json.loads(row["receipt_json"]) if row["receipt_json"] else None
            # stored once; only a conclusion the review page inferred (an Diple without
            # settled) gives way to the real event arriving later — and an Diple that
            # declared `settles` is never second-guessed (ADR 0007 §6)
            refused = bool(settled.get("inferred")) and bool((receipt0 or {}).get("settles"))
            if not refused and (prev is None or (prev.get("inferred") and not settled.get("inferred"))):
                self._conn.execute("UPDATE handoffs SET settled_json = ? WHERE handoff_id = ?",
                                   (json.dumps(settled, ensure_ascii=False), handoff_id))
                payload = json.loads(row["payload"])
                receipt = json.loads(row["receipt_json"]) if row["receipt_json"] else None
                accepted = set((receipt or {}).get("accepted") or []) if receipt else None
                session_id = payload.get("targetSessionId") or ""
                batch_id = str(settled.get("batchId") or (receipt or {}).get("batchId") or "")
                # R4 XE4-02 / R5: each item's word (item_outcomes, shared with the sender). An
                # item that never rode in the batch ('removed' / 'replaced' in Diple) is not
                # in any session's list either.
                ids = [((it or {}).get("origin") or {}).get("itemId") for it in payload.get("items") or []]
                words = {w["itemId"]: w for w in item_outcomes(settled, [i for i in ids if isinstance(i, str)])}
                for it in payload.get("items") or []:
                    o = (it or {}).get("origin") or {}
                    if accepted is not None and o.get("itemId") not in accepted:
                        continue
                    item = self._get_row(o.get("itemId"))
                    if item is None or item["revision"] != o.get("revision"):
                        continue
                    word = words.get(o.get("itemId")) or {"delivered": False}
                    delivered = word["delivered"]
                    why = word.get("reason")
                    sessions = json.loads(item["sent_sessions_json"] or "[]")
                    sets: dict[str, Any] = {}
                    if delivered:
                        if session_id and not any(x.get("batchId") == batch_id for x in sessions):
                            sessions.append({"sessionId": session_id, "batchId": batch_id, "at": now,
                                             "revision": o.get("revision")})
                            sets["sent_sessions_json"] = json.dumps(sessions, ensure_ascii=False)
                        if item["status"] == "pending":
                            sets.update(status="sent", queued_json=None)
                    elif item["status"] in ("pending", "sent"):
                        kept = [x for x in sessions if not batch_id or x.get("batchId") != batch_id]
                        if why in ("removed", "replaced"):
                            queued_json = None  # gone from Diple's list: plain pending here
                        else:
                            queued = {"sessionId": session_id, "revision": item["revision"], "at": now, "sendNow": False}
                            queued_json = json.dumps(queued, ensure_ascii=False)
                        sets.update(status="pending", sent_sessions_json=json.dumps(kept, ensure_ascii=False),
                                    queued_json=queued_json)
                    if sets:
                        sets["updated_at"] = now
                        cols = ", ".join(f"{k} = ?" for k in sets)
                        self._conn.execute(f"UPDATE items SET {cols} WHERE id = ?", (*sets.values(), item["id"]))
                        touched.append(item["id"])
            self._conn.commit()
            row = self._conn.execute("SELECT * FROM handoffs WHERE handoff_id = ?", (handoff_id,)).fetchone()
        return self._handoff(row), touched

    def replayable(self, handoff_id: str) -> dict:
        """May an unconfirmed hand-off be broadcast again under its OWN id (XR-03)?

        ``{"replayed": False, "receipt": …}`` when it already has a receipt,
        ``{"replayed": False, "reason": "stale"}`` when an item changed (or is
        gone) since — replaying would send an old version — else ``{"replayed": True}``.
        """
        h = self.get_handoff(handoff_id)
        if h is None:
            return {"replayed": False, "reason": "unknown"}
        if h["receipt"] is not None:
            return {"replayed": False, "receipt": h["receipt"]}
        with self._lock:
            for it in h["payload"].get("items") or []:
                o = (it or {}).get("origin") or {}
                row = self._get_row(o.get("itemId")) if valid_item_id(o.get("itemId")) else None
                if row is None or row["revision"] != o.get("revision") or row["status"] == "resolved":
                    return {"replayed": False, "reason": "stale"}
        return {"replayed": True}

    def cancel_handoff(self, handoff_id: str) -> Any:
        """The sender gave up waiting (no receipt in time): never rebroadcast it again."""
        with self._lock:
            self._conn.execute("UPDATE handoffs SET cancelled_at = ? WHERE handoff_id = ? AND cancelled_at IS NULL "
                               "AND receipt_json IS NULL", (self._now(), handoff_id))
            self._conn.commit()
            row = self._conn.execute("SELECT * FROM handoffs WHERE handoff_id = ?", (handoff_id,)).fetchone()
        return self._handoff(row)

    def unconfirmed_handoffs(self, max_age: float = 600.0, limit: int = 50) -> list[dict]:
        """Hand-offs the sender gave up on (timeout) that never got a receipt (XR-03).

        The receiver may still have taken them, so re-sending their items needs the
        user's explicit choice. Shared by every window and survives reloads.
        """
        since = self._now() - max(0.0, float(max_age))
        with self._lock:
            rows = self._conn.execute(
                "SELECT handoff_id, payload FROM handoffs WHERE receipt_json IS NULL AND cancelled_at IS NOT NULL "
                "AND created_at >= ? ORDER BY created_at DESC LIMIT ?",
                (since, max(1, min(int(limit), 200))),
            ).fetchall()
        out = []
        for r in rows:
            items = json.loads(r["payload"]).get("items") or []
            ids = [((it or {}).get("origin") or {}).get("itemId") for it in items]
            out.append({"handoffId": r["handoff_id"], "itemIds": [i for i in ids if isinstance(i, str)]})
        return out

    def pending_handoffs(self, limit: int = 50, max_age: Optional[float] = None) -> list[dict]:
        """Hand-offs still waiting for a receipt (not cancelled), oldest first."""
        since = self._now() - max_age if max_age else 0
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM handoffs WHERE receipt_json IS NULL AND cancelled_at IS NULL AND created_at >= ? "
                "ORDER BY created_at ASC LIMIT ?",
                (since, max(1, min(int(limit), 200))),
            ).fetchall()
        return [self._handoff(r) for r in rows]

    # -- settings (mirrored from the desktop half; read by the agent hooks) -------
    def get_settings(self) -> dict:
        with self._lock:
            rows = self._conn.execute("SELECT key, value FROM settings").fetchall()
        out = dict(DEFAULT_SETTINGS)
        for r in rows:
            if r["key"] in DEFAULT_SETTINGS:
                out[r["key"]] = json.loads(r["value"])
        return out

    def set_settings(self, patch: dict) -> dict:
        with self._lock:
            for k, v in (patch or {}).items():
                if k in DEFAULT_SETTINGS and isinstance(v, type(DEFAULT_SETTINGS[k])):
                    self._conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                                       "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, json.dumps(v)))
            self._conn.commit()
        return self.get_settings()

    # -- the "open review" card: files written during a turn ----------------------
    def record_turn_write(self, session_id: str, turn_id: str, path: str) -> None:
        now = self._now()
        with self._lock:
            self._conn.execute("DELETE FROM turn_writes WHERE at < ?", (now - TURN_WRITE_TTL,))
            self._conn.execute("INSERT OR IGNORE INTO turn_writes (session_id, turn_id, path, at) VALUES (?, ?, ?, ?)",
                               (session_id or "", turn_id or "", path, now))
            self._conn.commit()

    def take_turn_writes(self, session_id: str, turn_id: str) -> list[str]:
        """Pop the files written in this turn (oldest first). An empty turn id on either side matches the session."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT path, turn_id FROM turn_writes WHERE session_id = ? AND (turn_id = ? OR turn_id = '' OR ? = '') "
                "ORDER BY at ASC", (session_id or "", turn_id or "", turn_id or "")).fetchall()
            self._conn.execute("DELETE FROM turn_writes WHERE session_id = ? AND (turn_id = ? OR turn_id = '' OR ? = '')",
                               (session_id or "", turn_id or "", turn_id or ""))
            self._conn.commit()
        seen, out = set(), []
        for r in rows:
            if r["path"] not in seen:
                seen.add(r["path"])
                out.append(r["path"])
        return out

    def close(self) -> None:
        with self._lock:
            self._conn.close()


_STORES: dict[str, ReviewStore] = {}
_STORES_LOCK = threading.Lock()


def store_for_current_home() -> ReviewStore:
    from hermes_constants import get_hermes_home

    home = str(get_hermes_home())
    with _STORES_LOCK:
        store = _STORES.get(home)
        if store is None:
            store = _STORES[home] = ReviewStore()
        return store


# -- the "open review" card ------------------------------------------------------------
WRITE_TOOLS = ("write_file", "patch")
CARD_DIRECTIVE = "diple-docs"
MAX_CARDS = 5


def written_review_paths(tool_name: Any, result: Any, status: Any = None) -> list[str]:
    """The .md/.markdown files a successful write_file / patch call reports it modified."""
    if tool_name not in WRITE_TOOLS:
        return []
    if status not in (None, "", "ok", "success"):
        return []
    data = result
    if isinstance(result, str):
        try:
            data = json.loads(result)
        except (ValueError, TypeError):
            return []
    if not isinstance(data, dict) or data.get("error") or data.get("success") is False:
        return []
    files = data.get("files_modified")
    if not isinstance(files, list) or not files:
        files = [data["resolved_path"]] if isinstance(data.get("resolved_path"), str) else []
    return [f for f in files if isinstance(f, str) and Path(f).is_absolute() and is_review_path(f)]


def card_directive(path: str) -> Optional[str]:
    """``::diple-docs{path="…"}``; None when the path cannot be quoted safely."""
    if any(ch in path for ch in "{}\n\r"):
        return None
    if '"' not in path:
        return f'::{CARD_DIRECTIVE}{{path="{path}"}}'
    if "'" not in path:
        return f"::{CARD_DIRECTIVE}{{path='{path}'}}"
    return None


def append_cards(response_text: str, paths: list[str]) -> Optional[str]:
    """The answer with one card per written file appended; None when there is nothing to add."""
    cards = []
    for p in paths:
        d = card_directive(p)
        if d and d not in response_text and d not in cards:
            cards.append(d)
    if not cards:
        return None
    return response_text.rstrip() + "\n\n" + "\n\n".join(cards[:MAX_CARDS])
