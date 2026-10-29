"""Diple Docs — REST routes at ``/api/plugins/diple-docs/``.

Loads ``../store.py`` by path (separate module instance; data shared via SQLite).

Documents are read-only here: the plugin never writes a document and never
writes anything next to one (requirement 03-#6/#13).
"""

from __future__ import annotations

import importlib.util
import json
import sys
import os
import time
from collections import deque
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request

_STORE_MODULE = "hermes_diple_docs_api_store"
REBROADCAST_MAX_AGE = 10 * 60


def _load_store_module():
    mod = sys.modules.get(_STORE_MODULE)
    if mod is not None:
        return mod
    path = Path(__file__).resolve().parent.parent / "store.py"
    spec = importlib.util.spec_from_file_location(_STORE_MODULE, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_STORE_MODULE] = mod
    spec.loader.exec_module(mod)
    return mod


_store_mod = _load_store_module()
PLUGIN_ID = _store_mod.PLUGIN_ID

# -- request journal (tests only, R11 XR11-09) ------------------------------------------
# The desktop bridge cannot be wrapped from a page, so the real-app click matrix counts
# the plugin's write requests here: every non-GET request, in order, with its body.
# Off unless DIPLE_DOCS_JOURNAL=1 (the e2e sandbox sets it); in memory, bounded.
JOURNAL_ENV = "DIPLE_DOCS_JOURNAL"
_journal: deque = deque(maxlen=2000)
_journal_seq = 0


def journal_enabled() -> bool:
    return os.environ.get(JOURNAL_ENV) == "1"


async def _record(request: Request) -> None:
    global _journal_seq
    if request.method == "GET" or not journal_enabled():
        return
    body: Any = None
    try:
        raw = await request.body()
        body = json.loads(raw) if raw else None
    except Exception:
        body = None
    path = request.url.path
    marker = f"/{PLUGIN_ID}/"
    route = path[path.index(marker) + len(marker) - 1:] if marker in path else path
    _journal_seq += 1
    _journal.append({"seq": _journal_seq, "at": time.time(), "method": request.method, "route": route,
                     "query": str(request.url.query or ""), "body": body})


router = APIRouter(dependencies=[Depends(_record)])


def get_store():
    return _store_mod.store_for_current_home()


def _broadcast(event: str, payload: dict) -> None:
    from hermes_cli.plugin_events import broadcast_plugin_event

    broadcast_plugin_event(PLUGIN_ID, event, payload)


def _stat(path: str):
    try:
        return _store_mod.stat_review_file(path)
    except _store_mod.ReviewFileError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code)


def _review_key(path: Any) -> str:
    """The list key for a document path; the suffix rule applies even when the file is gone."""
    if not isinstance(path, str) or not path.strip():
        raise HTTPException(status_code=400, detail="path-required")
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise HTTPException(status_code=400, detail="path-not-absolute")
    if not _store_mod.is_review_path(p.name):
        raise HTTPException(status_code=415, detail="unsupported-suffix")
    # lexical: `a/../b.md` and `b.md` are one list. Symlink aliases are NOT merged
    # (the file may be gone, and keys must not move under existing lists) — see 已知限制.
    key = os.path.normpath(str(p))
    if not _store_mod.is_review_path(Path(key).name):
        raise HTTPException(status_code=415, detail="unsupported-suffix")
    return key


def _items_call(fn, *args, **kwargs) -> Any:
    try:
        return fn(*args, **kwargs)
    except _store_mod.ItemError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code)


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "plugin": PLUGIN_ID, "v": 1}


# -- documents ----------------------------------------------------------------------
@router.get("/file")
async def read_file(path: str) -> dict:
    """Read a .md/.markdown document. Read-only: this plugin never writes documents."""
    try:
        text, st = _store_mod.read_review_file(path)
    except _store_mod.ReviewFileError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code)
    key = _review_key(path)  # the list stays keyed by the path the user opened
    get_store().touch_review(key)
    return {"path": key, "text": text, "mtime": st.st_mtime, "size": st.st_size}


@router.get("/file/stat")
async def stat_file(path: str) -> dict:
    """Cheap change check for the 2 s refresh poll."""
    st = _stat(path)
    return {"path": _review_key(path), "mtime": st.st_mtime, "size": st.st_size}


@router.get("/review/state")
async def review_state(path: str) -> dict:
    """One poll for both halves of the page: the file's mtime and the list's version.

    A missing file is not an error here: the list stays usable and the page
    says the file is gone.
    """
    key = _review_key(path)
    out: dict[str, Any] = {"path": key, "itemsVersion": get_store().items_version(key)}
    try:
        st = _store_mod.stat_review_file(key)
        out.update(exists=True, mtime=st.st_mtime, size=st.st_size)
    except _store_mod.ReviewFileError as exc:
        out.update(exists=False, error=exc.code)
    return out


@router.get("/reviews/recent")
async def recent_reviews(limit: int = 20) -> dict:
    return {"reviews": get_store().recent_reviews(limit)}


@router.get("/debug/journal")
async def read_journal(since: int = 0) -> dict:
    """The write requests since ``seq`` (tests only: 404 unless DIPLE_DOCS_JOURNAL=1)."""
    if not journal_enabled():
        raise HTTPException(status_code=404, detail="journal off")
    return {"seq": _journal_seq, "entries": [e for e in _journal if e["seq"] > since]}


@router.delete("/reviews/recent")
async def forget_review(path: str) -> dict:
    get_store().forget_review(_review_key(path))
    return {"ok": True}


# -- the review list --------------------------------------------------------------------
@router.get("/items")
async def list_items(path: str) -> dict:
    key = _review_key(path)
    store = get_store()
    return {"path": key, "items": store.list_items(key), "itemsVersion": store.items_version(key)}


SUMMARY_MAX_PATHS = 200


@router.post("/items/summary")
async def items_summary(body: dict = Body(...)) -> dict:
    """Read-only counts for many lists in one call (V3-D2): the transcript's
    ::diple-docs cards ask together instead of one GET /items each. A bad path
    is reported in its own entry; it never fails the call for the others.
    Keys echo the paths as sent, so each card finds its own answer."""
    paths = body.get("paths")
    if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
        raise HTTPException(status_code=400, detail="paths must be a list of strings")
    paths = list(dict.fromkeys(paths))
    if len(paths) > SUMMARY_MAX_PATHS:
        raise HTTPException(status_code=413, detail="too-many-paths")
    keyed: dict[str, str] = {}
    out: dict[str, Any] = {}
    for p in paths:
        try:
            keyed[p] = _review_key(p)
        except HTTPException as exc:
            out[p] = {"error": exc.detail}
    counts = get_store().item_counts(keyed.values())
    for p, key in keyed.items():
        out[p] = counts[key]
    return {"counts": out}


@router.post("/items")
async def add_item(body: dict = Body(...)) -> dict:
    key = _review_key(body.get("path"))
    return _items_call(get_store().add_item, key, body.get("anchor"), body.get("comment") or "")


@router.post("/items/restore")
async def restore_item(body: dict = Body(...)) -> dict:
    """Undo a delete: put the item back exactly as it was."""
    return _items_call(get_store().restore_item, body)


@router.post("/items/bulk-delete")
async def bulk_delete(body: dict = Body(...)) -> dict:
    """V3-D2 清除…: ``{path, ids, expectMutations?}`` → ``{deleted: [snapshots]}``; all or nothing (409 stale)."""
    key = _review_key(body.get("path"))
    return {"deleted": _items_call(get_store().delete_items, key, body.get("ids"), body.get("expectMutations"))}


@router.post("/items/bulk-restore")
async def bulk_restore(body: dict = Body(...)) -> dict:
    """Undo a bulk clear: ``{items: [snapshots]}`` → ``{restored}``; all or nothing."""
    return {"restored": _items_call(get_store().restore_items, body.get("items"))}


@router.post("/items/bulk-resolve")
async def bulk_resolve(body: dict = Body(...)) -> dict:
    """全部标为已解决: ``{path, ids, expectMutations?}`` → ``{resolved: [ids that changed]}``."""
    key = _review_key(body.get("path"))
    return {"resolved": _items_call(get_store().resolve_items, key, body.get("ids"), body.get("expectMutations"))}


@router.post("/items/locate")
async def apply_locations(body: dict = Body(...)) -> dict:
    key = _review_key(body.get("path"))
    results = body.get("results")
    if not isinstance(results, list):
        raise HTTPException(status_code=400, detail="results must be a list")
    return {"changed": get_store().apply_locations(key, results)}


@router.patch("/items/{item_id}")
async def update_item(item_id: str, body: dict = Body(...)) -> dict:
    """``{op: comment|replace|resolve|reopen, comment?, anchor?, expectMutation?, expectRevision?}``."""
    if not _store_mod.valid_item_id(item_id):
        raise HTTPException(status_code=400, detail="invalid-item")
    return _items_call(get_store().update_item, item_id, str(body.get("op") or ""), comment=body.get("comment"),
                       anchor=body.get("anchor"), expect_revision=body.get("expectRevision"),
                       expect_mutation=body.get("expectMutation"))


@router.delete("/items/{item_id}")
async def delete_item(item_id: str) -> dict:
    if not _store_mod.valid_item_id(item_id):
        raise HTTPException(status_code=400, detail="invalid-item")
    return {"deleted": get_store().delete_item(item_id)}


# -- events relayed by the desktop half (every window relays; the store is idempotent) --
@router.post("/events/batch-sent")
async def on_batch_sent(body: dict = Body(...)) -> dict:
    """``plugin.diple.batch.sent`` {v:1, batchId, sessionId, items:[{origin}]}."""
    if body.get("v") != 1:
        raise HTTPException(status_code=400, detail="unsupported payload version")
    return {"touched": get_store().apply_sent(body)}


@router.post("/events/batch-answered")
async def on_batch_answered(body: dict = Body(...)) -> dict:
    """``plugin.diple.batch.answered`` {v:1, batchId, answered:[{origin}]}."""
    if body.get("v") != 1:
        raise HTTPException(status_code=400, detail="unsupported payload version")
    return {"touched": get_store().apply_answered(body)}


# -- hand-offs to the Diple plugin (design §4) ------------------------------------------
@router.post("/handoffs")
async def create_handoff(body: dict = Body(...)) -> dict:
    """Store a hand-off and broadcast ``plugin.diple-docs.handoff`` (payload v1, design §4)."""
    if body.get("v") != 1:
        raise HTTPException(status_code=400, detail="unsupported payload version")
    if not _store_mod.valid_handoff_id(body.get("handoffId")):
        raise HTTPException(status_code=400, detail="invalid handoff id")
    if not isinstance(body.get("items"), list) or not body["items"]:
        raise HTTPException(status_code=400, detail="items required")
    saved = get_store().save_handoff(body)
    _broadcast("handoff", saved["payload"])
    return saved


@router.get("/handoffs")
async def list_pending_handoffs(maxAge: float = 0) -> dict:
    return {"handoffs": get_store().pending_handoffs(max_age=maxAge or None)}


@router.get("/handoffs/unconfirmed")
async def list_unconfirmed_handoffs(maxAge: float = 600) -> dict:
    """Timed-out hand-offs with no receipt: their items may already have been sent (XR-03)."""
    return {"handoffs": get_store().unconfirmed_handoffs(max_age=maxAge)}


@router.get("/handoffs/{handoff_id}")
async def get_handoff(handoff_id: str) -> dict:
    h = get_store().get_handoff(handoff_id)
    if h is None:
        raise HTTPException(status_code=404, detail="unknown handoff")
    return h


@router.post("/handoffs/{handoff_id}/receipt")
async def handoff_receipt(handoff_id: str, body: dict = Body(...)) -> dict:
    h = get_store().get_handoff(handoff_id)
    if h is None:
        raise HTTPException(status_code=404, detail="unknown handoff")
    return get_store().record_receipt(handoff_id, body)


@router.post("/handoffs/{handoff_id}/settled")
async def handoff_settled(handoff_id: str, body: dict = Body(...)) -> dict:
    """Relay of ``plugin.diple.handoff.settled`` {v:1, handoffId, batchId, delivered, reason?} (XR-09)."""
    if body.get("v") != 1 or body.get("handoffId") != handoff_id or not isinstance(body.get("delivered"), bool):
        raise HTTPException(status_code=400, detail="invalid settled payload")
    settled = {"handoffId": handoff_id, "delivered": body["delivered"]}
    if isinstance(body.get("batchId"), str) and body["batchId"]:
        settled["batchId"] = body["batchId"][:128]
    if isinstance(body.get("reason"), str) and body["reason"] and not body["delivered"]:
        settled["reason"] = body["reason"][:200]
    if body.get("inferred") in ("batch.answered", "batch.sent"):
        settled["inferred"] = body["inferred"]
    if "items" in body:  # optional (R4 XE4-02): [{itemId, delivered, reason?}] when not every item went out
        items = body["items"]
        if not isinstance(items, list) or any(
                not isinstance(x, dict) or not isinstance(x.get("itemId"), str) or not isinstance(x.get("delivered"), bool)
                for x in items):
            raise HTTPException(status_code=400, detail="invalid settled items")
        settled["items"] = [{"itemId": x["itemId"][:128], "delivered": x["delivered"],
                             **({"reason": x["reason"][:100]} if isinstance(x.get("reason"), str) and not x["delivered"] else {})}
                            for x in items[:500]]
    h, touched = get_store().record_settled(handoff_id, settled)
    if h is None:
        raise HTTPException(status_code=404, detail="unknown handoff")
    return {**h, "touched": touched}


@router.post("/handoffs/{handoff_id}/replay")
async def replay_handoff(handoff_id: str) -> dict:
    """「仍然发送」: re-broadcast an unconfirmed (even timed-out) hand-off under its own id, so the
    receiver replays its result instead of running a second hand-off (XR-03)."""
    r = get_store().replayable(handoff_id)
    if r.get("reason") == "unknown":
        raise HTTPException(status_code=404, detail="unknown handoff")
    if r["replayed"]:
        _broadcast("handoff", get_store().get_handoff(handoff_id)["payload"])
    return r


@router.post("/handoffs/{handoff_id}/cancel")
async def cancel_handoff(handoff_id: str) -> dict:
    h = get_store().get_handoff(handoff_id)
    if h is None:
        raise HTTPException(status_code=404, detail="unknown handoff")
    return get_store().cancel_handoff(handoff_id)


@router.post("/handoffs/{handoff_id}/rebroadcast")
async def rebroadcast_handoff(handoff_id: str, body: Optional[dict] = Body(default=None)) -> dict:
    """Re-send a hand-off that never got a receipt (idempotent on the receiver via claim).

    ``{"settle": true}``: re-send one that has a receipt but no settled yet, so a receiver
    that keeps the settled outcome with its claim replays it (XR-09)."""
    h = get_store().get_handoff(handoff_id)
    if h is None:
        raise HTTPException(status_code=404, detail="unknown handoff")
    if isinstance(body, dict) and body.get("settle") is True:
        ok = h["receipt"] is not None and (h.get("settled") is None or bool(h["settled"].get("inferred")))
    else:
        ok = h["receipt"] is None and not h.get("cancelledAt")
    if ok:
        _broadcast("handoff", h["payload"])
    return {"rebroadcast": ok}


@router.post("/handoffs/rebroadcast-pending")
async def rebroadcast_pending() -> dict:
    """On page mount: re-send every recent hand-off still waiting for a receipt."""
    sent = []
    for h in get_store().pending_handoffs(max_age=REBROADCAST_MAX_AGE):
        _broadcast("handoff", h["payload"])
        sent.append(h["handoffId"])
    return {"rebroadcast": sent}


# -- settings mirrored from the desktop half (the agent hooks read them) -----------------
def _session_label(db: Any, sid: str) -> str:
    """The stored title, else the first user message preview the sidebar shows for untitled chats."""
    try:
        row = db.get_session(sid)
    except Exception:
        row = None
    title = row.get("title") if isinstance(row, dict) else None
    if isinstance(title, str) and title.strip():
        return title.strip()
    if row is None:
        return ""
    try:  # host internals: best effort, the chip falls back to "untitled" when this moves
        from hermes_state_common import _shape_preview, _sql_preview_raw

        prev = db._read_one(f"SELECT {_sql_preview_raw()} FROM sessions s WHERE s.id = ?", (sid,))
        return _shape_preview(prev["_preview_raw"] if prev else "")
    except Exception:
        return ""


@router.get("/sessions/titles")
async def session_titles(ids: str = "") -> dict:
    """Best-effort titles for the "sent to" chips; unknown or unreadable sessions are omitted."""
    wanted = [i for i in ids.split(",") if i and len(i) <= 200][:50]
    out: dict[str, str] = {}
    if not wanted:
        return {"titles": out}
    try:
        from hermes_state import SessionDB

        db = SessionDB(read_only=True)
        try:
            for sid in wanted:
                label = _session_label(db, sid)
                if label:
                    out[sid] = label
        finally:
            close = getattr(db, "close", None)
            if callable(close):
                close()
    except Exception:
        pass
    return {"titles": out}


@router.get("/settings")
async def get_settings() -> dict:
    return get_store().get_settings()


@router.put("/settings")
async def put_settings(body: dict = Body(...)) -> dict:
    return get_store().set_settings(body)
