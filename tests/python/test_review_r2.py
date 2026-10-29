"""R2 code review (Diple Docs): XR-01 file authorisation closed on the opened fd,
XR2-01 resolve/reopen invalidate stale editors, XR-09 settled hand-offs, XR-03 replay.

Every sensitive location is a fake one under a temporary HERMES_HOME / HOME.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import REPO, load_api_module

PLUGIN_DIR = REPO / "plugins" / "diple-docs" / "python"
P = "/api/plugins/diple-docs"
SENTINEL = "FAKE_NOT_REAL_VAULT_CONTENT"


@pytest.fixture
def api(hermes_home, monkeypatch):
    mod = load_api_module(PLUGIN_DIR, "diple-docs", "hermes_diple_docs_api_store")
    events = []
    monkeypatch.setattr(mod, "_broadcast", lambda e, p: events.append((e, p)))
    st = mod._store_mod.ReviewStore(connect=lambda: sqlite3.connect(":memory:", check_same_thread=False))
    monkeypatch.setattr(mod, "get_store", lambda: st)
    app = FastAPI()
    app.include_router(mod.router, prefix=P)
    client = TestClient(app)
    client.events, client.mod, client.store = events, mod, st
    return client


@pytest.fixture
def store_mod(api):
    return api.mod._store_mod


@pytest.fixture
def vault(hermes_home):
    v = hermes_home / "vault"
    v.mkdir()
    (v / "hidden.md").write_text(SENTINEL + "\n")
    return v


def read(api, path):
    return api.get(f"{P}/file", params={"path": str(path)})


def between(monkeypatch, store_mod, fn):
    """Run fn after the path was checked and before it is opened (the TOCTOU window)."""
    monkeypatch.setattr(store_mod, "_between_check_and_open", lambda canonical: fn())


# -- XR-01: parent directory swapped between the check and the open --------------------------
def test_parent_swapped_for_a_symlink_to_the_vault_is_refused(api, store_mod, vault, tmp_path, monkeypatch):
    public = tmp_path / "public"
    public.mkdir()
    (public / "hidden.md").write_text("# SAFE\n")

    def swap():
        public.rename(tmp_path / "public-old")
        public.symlink_to(vault, target_is_directory=True)

    between(monkeypatch, store_mod, swap)
    r = read(api, public / "hidden.md")
    assert SENTINEL not in r.text
    assert (r.status_code, r.json()["detail"]) == (409, "path-changed")


def test_the_vault_itself_moved_into_place_is_refused_by_identity(api, store_mod, vault, tmp_path, monkeypatch):
    public = tmp_path / "public"
    public.mkdir()
    (public / "hidden.md").write_text("# SAFE\n")

    def swap():  # no symlink anywhere: the real vault folder now sits at the checked path
        public.rename(tmp_path / "public-old")
        vault.rename(public)

    between(monkeypatch, store_mod, swap)
    r = read(api, public / "hidden.md")
    assert SENTINEL not in r.text
    assert (r.status_code, r.json()["detail"]) == (403, "sensitive-path")


def test_a_credential_file_renamed_into_place_is_refused_by_identity(api, store_mod, hermes_home, tmp_path, monkeypatch):
    env = hermes_home / ".env"
    env.write_text("SENTINEL_ENV=1\n")
    doc = tmp_path / "doc.md"
    doc.write_text("# SAFE\n")
    between(monkeypatch, store_mod, lambda: os.replace(env, doc))
    r = read(api, doc)
    assert "SENTINEL_ENV" not in r.text
    assert (r.status_code, r.json()["detail"]) == (403, "sensitive-path")


def test_final_file_swapped_for_a_symlink_is_refused(api, store_mod, tmp_path, monkeypatch):
    secret = tmp_path / "private.env"
    secret.write_text("SENTINEL_PRIVATE=1\n")
    doc = tmp_path / "race-final.md"
    doc.write_text("# SAFE\n")

    def swap():
        doc.unlink()
        doc.symlink_to(secret)

    between(monkeypatch, store_mod, swap)
    r = read(api, doc)
    assert "SENTINEL_PRIVATE" not in r.text
    assert (r.status_code, r.json()["detail"]) == (409, "path-changed")


def test_a_parent_replaced_by_a_file_reads_nothing(api, store_mod, tmp_path, monkeypatch):
    d = tmp_path / "d"
    d.mkdir()
    (d / "x.md").write_text("# SAFE\n")

    def swap():
        d.rename(tmp_path / "d-old")
        d.write_text("not a folder")

    between(monkeypatch, store_mod, swap)
    assert read(api, d / "x.md").status_code == 404


def test_the_opened_handle_is_what_gets_read(api, store_mod, tmp_path, monkeypatch):
    """After the open, a path swap cannot change what is read (same fd for fstat + read)."""
    doc = tmp_path / "after-open.md"
    doc.write_text("SAFE_ORIGINAL_FD\n")
    other = tmp_path / "replacement.md"
    other.write_text("DIFFERENT_NEW_INODE\n")
    real_fstat = os.fstat
    swapped = []

    def fstat(fd):
        st = real_fstat(fd)
        if not swapped and store_mod.stat_mod.S_ISREG(st.st_mode):
            swapped.append(1)
            os.replace(other, doc)
        return st

    monkeypatch.setattr(store_mod.os, "fstat", fstat)
    assert read(api, doc).json()["text"] == "SAFE_ORIGINAL_FD\n"


# -- XR-01: hard links ------------------------------------------------------------------------
def test_hardlink_to_a_non_markdown_file_is_refused(api, tmp_path):
    secret = tmp_path / "private.env"
    secret.write_text("SENTINEL_PRIVATE=1\n")
    hard = tmp_path / "hardlink.md"
    os.link(secret, hard)
    r = read(api, hard)
    assert "SENTINEL" not in r.text
    assert (r.status_code, r.json()["detail"]) == (415, "hardlinked")


def test_hardlink_to_a_vault_file_is_refused(api, vault, tmp_path):
    hard = tmp_path / "hardlink-vault.md"
    os.link(vault / "hidden.md", hard)
    r = read(api, hard)
    assert SENTINEL not in r.text
    assert (r.status_code, r.json()["detail"]) == (415, "hardlinked")


def test_a_legitimate_hardlinked_markdown_file_is_refused_too(api, tmp_path):
    """The known price: two names for one Markdown file → neither opens (已知限制)."""
    a = tmp_path / "a.md"
    a.write_text("# plain\n")
    os.link(a, tmp_path / "b.md")
    for p in (a, tmp_path / "b.md"):
        assert read(api, p).json()["detail"] == "hardlinked"


def test_stat_and_poll_use_the_same_authorisation(api, vault, tmp_path):
    hard = tmp_path / "hardlink-vault.md"
    os.link(vault / "hidden.md", hard)
    assert api.get(f"{P}/file/stat", params={"path": str(hard)}).json()["detail"] == "hardlinked"
    st = api.get(f"{P}/review/state", params={"path": str(hard)}).json()
    assert st["exists"] is False and st["error"] == "hardlinked"


# -- XR-01: names -------------------------------------------------------------------------------
@pytest.mark.parametrize("name,status", [
    ("note.md", 200), ("note.markdown", 200), ("NOTE.MD", 200), ("NOTE.MARKDOWN", 200), ("Mixed.Md", 200),
    ("note.md ", 415), ("note.md.", 415), ("note.markdown ", 415), ("note.markdown.", 415),
    ("note.ｍｄ", 415), ("note.ｍd", 415), ("note.mԁ", 415), ("note．md", 415), ("note.md\u200b", 415),
    ("note.env", 415), ("md", 415),
])
def test_suffix_matrix(api, tmp_path, name, status):
    p = tmp_path / name
    p.write_text("# SAFE\n")
    r = read(api, p)
    assert r.status_code == status, r.text
    if status == 415:
        assert r.json()["detail"] == "unsupported-suffix"


@pytest.mark.parametrize("kind", ["fifo", "dir"])
def test_fifo_and_directory_are_not_regular(api, tmp_path, kind):
    p = tmp_path / f"{kind}.md"
    os.mkfifo(p) if kind == "fifo" else p.mkdir()
    r = read(api, p)
    assert (r.status_code, r.json()["detail"]) == (415, "not-regular")


def test_symlinks_resolved_before_the_walk_still_work(api, tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    (real / "ok.md").write_text("# fine\n")
    (tmp_path / "dir-link").symlink_to(real, target_is_directory=True)
    (tmp_path / "alias.md").symlink_to(real / "ok.md")
    assert read(api, tmp_path / "dir-link" / "ok.md").json()["text"] == "# fine\n"
    assert read(api, tmp_path / "alias.md").json()["text"] == "# fine\n"


def test_a_folder_without_read_permission_is_refused(api, tmp_path):
    d = tmp_path / "x-only"
    d.mkdir()
    (d / "a.md").write_text("# hi\n")
    d.chmod(0o311)
    try:
        assert read(api, d / "a.md").status_code == 404
    finally:
        d.chmod(0o755)


def test_host_checkpoint_is_consulted_and_fails_closed(api, tmp_path, monkeypatch):
    doc = tmp_path / "blocked-by-host.md"
    doc.write_text("# x\n")
    fake = types.ModuleType("agent.file_safety")
    fake.get_read_block_error = lambda p: "blocked" if p.endswith("blocked-by-host.md") else None
    monkeypatch.setitem(sys.modules, "agent.file_safety", fake)
    assert read(api, doc).json()["detail"] == "sensitive-path"

    def broken(p):
        raise RuntimeError("host check broke")

    fake.get_read_block_error = broken
    ok = tmp_path / "fine.md"
    ok.write_text("# fine\n")
    assert read(api, ok).status_code == 403


# -- XR2-01: every user change moves the edit token -------------------------------------------------
A = {"text": "original", "before": "", "after": "", "line": 1}


def test_resolve_makes_a_stale_comment_draft_conflict(api):
    it = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": A, "comment": "first"}).json()
    # window B opens its editor on this version
    b_base = it["mutation"]
    # window A resolves
    r = api.patch(f"{P}/items/{it['id']}", json={"op": "resolve", "expectMutation": it["mutation"]}).json()
    assert r["status"] == "resolved" and r["mutation"] > b_base
    assert r["revision"] == it["revision"]  # origin revision semantics unchanged
    # window B saves its draft against the version it started from
    stale = api.patch(f"{P}/items/{it['id']}", json={"op": "comment", "comment": "B's draft", "expectMutation": b_base})
    assert (stale.status_code, stale.json()["detail"]) == (409, "stale")
    assert api.get(f"{P}/items", params={"path": "/work/case.md"}).json()["items"][0]["status"] == "resolved"


def test_reopen_moves_the_token_too(api):
    it = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": A}).json()
    r1 = api.patch(f"{P}/items/{it['id']}", json={"op": "resolve", "expectMutation": it["mutation"]}).json()
    r2 = api.patch(f"{P}/items/{it['id']}", json={"op": "reopen", "expectMutation": r1["mutation"]}).json()
    assert r2["status"] == "pending" and r2["mutation"] > r1["mutation"]
    assert api.patch(f"{P}/items/{it['id']}", json={"op": "resolve", "expectMutation": r1["mutation"]}).status_code == 409


def test_events_from_diple_do_not_move_the_token(api):
    """batch.sent / answered are not user edits: an editor open meanwhile must not conflict."""
    it = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": A, "comment": "c"}).json()
    origin = {"plugin": "diple-docs", "itemId": it["id"], "revision": it["revision"], "path": "/work/case.md", "line": 1}
    api.post(f"{P}/events/batch-sent", json={"v": 1, "batchId": "b1", "sessionId": "s1", "items": [{"origin": origin}]})
    api.post(f"{P}/events/batch-answered", json={"v": 1, "batchId": "b1", "answered": [{"origin": origin}]})
    now = api.get(f"{P}/items", params={"path": "/work/case.md"}).json()["items"][0]
    assert now["status"] == "answered" and now["mutation"] == it["mutation"]
    ok = api.patch(f"{P}/items/{it['id']}", json={"op": "comment", "comment": "follow-up", "expectMutation": it["mutation"]})
    assert ok.status_code == 200 and ok.json()["status"] == "pending"


def test_old_clients_with_expect_revision_still_work(api):
    it = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": A}).json()
    r = api.patch(f"{P}/items/{it['id']}", json={"op": "comment", "comment": "x", "expectRevision": it["revision"]})
    assert r.status_code == 200
    assert api.patch(f"{P}/items/{it['id']}", json={"op": "comment", "comment": "y", "expectRevision": it["revision"]}).status_code == 409


def test_restore_keeps_the_token(api):
    it = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": A}).json()
    r = api.patch(f"{P}/items/{it['id']}", json={"op": "resolve", "expectMutation": it["mutation"]}).json()
    api.delete(f"{P}/items/{it['id']}")
    back = api.post(f"{P}/items/restore", json=r).json()
    assert back["mutation"] == r["mutation"]


# -- XR-09: two-phase hand-off result (receipt → settled) -------------------------------------
def _sent_handoff(api, hid="h-r2-0001", send_now=True):
    it = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": A, "comment": "c"}).json()
    origin = {"plugin": "diple-docs", "itemId": it["id"], "revision": it["revision"], "path": "/work/case.md", "line": 1}
    payload = {"v": 1, "handoffId": hid, "targetSessionId": "s1", "sendNow": send_now,
               "items": [{"origin": origin, "text": "original", "comment": "c"}]}
    api.post(f"{P}/handoffs", json=payload)
    return it, origin


def _item(api):
    return api.get(f"{P}/items", params={"path": "/work/case.md"}).json()["items"][0]


def test_a_receipt_with_a_batch_is_only_submitted_until_settled(api):
    it, origin = _sent_handoff(api)
    api.post(f"{P}/handoffs/h-r2-0001/receipt", json={"v": 1, "handoffId": "h-r2-0001", "accepted": [it["id"]], "batchId": "b1"})
    now = _item(api)
    assert now["status"] == "pending" and now["queued"]["batchId"] == "b1", "waiting for confirmation"
    assert api.get(f"{P}/handoffs/h-r2-0001").json()["settled"] is None


def test_settled_delivered_marks_sent_even_without_batch_sent(api):
    it, _ = _sent_handoff(api)
    api.post(f"{P}/handoffs/h-r2-0001/receipt", json={"v": 1, "handoffId": "h-r2-0001", "accepted": [it["id"]], "batchId": "b1"})
    r = api.post(f"{P}/handoffs/h-r2-0001/settled", json={"v": 1, "handoffId": "h-r2-0001", "batchId": "b1", "delivered": True}).json()
    assert r["touched"] == [it["id"]]
    now = _item(api)
    assert now["status"] == "sent" and now["queued"] is None
    assert [s["batchId"] for s in now["sentSessions"]] == ["b1"]
    assert api.get(f"{P}/handoffs/h-r2-0001").json()["settled"]["delivered"] is True


def test_settled_not_delivered_puts_the_item_back_to_pending(api):
    it, origin = _sent_handoff(api)
    api.post(f"{P}/handoffs/h-r2-0001/receipt", json={"v": 1, "handoffId": "h-r2-0001", "accepted": [it["id"]], "batchId": "b1"})
    # the batch was expanded first (batch.sent) — then the turn failed
    api.post(f"{P}/events/batch-sent", json={"v": 1, "batchId": "b1", "sessionId": "s1", "items": [{"origin": origin}]})
    assert _item(api)["status"] == "sent"
    body = {"v": 1, "handoffId": "h-r2-0001", "batchId": "b1", "delivered": False, "reason": "turn-error"}
    api.post(f"{P}/handoffs/h-r2-0001/settled", json=body)
    now = _item(api)
    assert now["status"] == "pending" and now["sentSessions"] == []
    assert now["queued"]["sessionId"] == "s1" and "batchId" not in now["queued"], "back in the pending list"
    assert api.get(f"{P}/handoffs/h-r2-0001").json()["settled"]["reason"] == "turn-error"
    # settled is stored once
    api.post(f"{P}/handoffs/h-r2-0001/settled", json={**body, "delivered": True})
    assert api.get(f"{P}/handoffs/h-r2-0001").json()["settled"]["delivered"] is False


def test_settled_never_touches_a_newer_revision_or_an_answer(api):
    it, origin = _sent_handoff(api)
    api.post(f"{P}/handoffs/h-r2-0001/receipt", json={"v": 1, "handoffId": "h-r2-0001", "accepted": [it["id"]], "batchId": "b1"})
    api.patch(f"{P}/items/{it['id']}", json={"op": "comment", "comment": "newer", "expectMutation": it["mutation"]})
    api.post(f"{P}/handoffs/h-r2-0001/settled", json={"v": 1, "handoffId": "h-r2-0001", "batchId": "b1", "delivered": True})
    assert _item(api)["status"] == "pending"


@pytest.mark.parametrize("body", [{"v": 2, "handoffId": "h-r2-0001", "delivered": True},
                                  {"v": 1, "handoffId": "h-r2-0001", "delivered": "yes"},
                                  {"v": 1, "handoffId": "other", "delivered": True}])
def test_settled_validation(api, body):
    _sent_handoff(api)
    assert api.post(f"{P}/handoffs/h-r2-0001/settled", json=body).status_code == 400


# -- XR-03: "send anyway" replays the old hand-off instead of minting a new id ----------------------
def test_replay_rebroadcasts_an_unconfirmed_handoff_with_its_old_id(api):
    it, _ = _sent_handoff(api)
    api.post(f"{P}/handoffs/h-r2-0001/cancel")
    api.events.clear()
    r = api.post(f"{P}/handoffs/h-r2-0001/replay").json()
    assert r == {"replayed": True}
    assert [(e, p["handoffId"]) for e, p in api.events] == [("handoff", "h-r2-0001")]


def test_replay_refuses_a_stale_payload_and_a_settled_one(api):
    it, _ = _sent_handoff(api)
    api.post(f"{P}/handoffs/h-r2-0001/cancel")
    api.patch(f"{P}/items/{it['id']}", json={"op": "comment", "comment": "edited since", "expectMutation": it["mutation"]})
    api.events.clear()
    assert api.post(f"{P}/handoffs/h-r2-0001/replay").json() == {"replayed": False, "reason": "stale"}
    assert api.events == []
    receipt = {"v": 1, "handoffId": "h-r2-0001", "accepted": [it["id"]]}
    api.post(f"{P}/handoffs/h-r2-0001/receipt", json=receipt)
    r = api.post(f"{P}/handoffs/h-r2-0001/replay").json()
    assert r["replayed"] is False and r["receipt"] == receipt


def test_an_inferred_settle_is_replaced_by_the_real_one(api):
    it, origin = _sent_handoff(api)
    api.post(f"{P}/handoffs/h-r2-0001/receipt", json={"v": 1, "handoffId": "h-r2-0001", "accepted": [it["id"]], "batchId": "b1"})
    api.post(f"{P}/handoffs/h-r2-0001/settled", json={"v": 1, "handoffId": "h-r2-0001", "batchId": "b1", "delivered": True,
                                                      "inferred": "batch.sent"})
    assert _item(api)["status"] == "sent"
    assert api.get(f"{P}/handoffs/h-r2-0001").json()["settled"]["inferred"] == "batch.sent"
    api.post(f"{P}/handoffs/h-r2-0001/settled", json={"v": 1, "handoffId": "h-r2-0001", "batchId": "b1", "delivered": False,
                                                      "reason": "turn-error"})
    st = api.get(f"{P}/handoffs/h-r2-0001").json()["settled"]
    assert st == {"handoffId": "h-r2-0001", "delivered": False, "batchId": "b1", "reason": "turn-error"}
    assert _item(api)["status"] == "pending"


def test_settle_rebroadcast_reaches_a_receiver_after_its_receipt(api):
    it, _ = _sent_handoff(api)
    api.post(f"{P}/handoffs/h-r2-0001/receipt", json={"v": 1, "handoffId": "h-r2-0001", "accepted": [it["id"]], "batchId": "b1"})
    api.events.clear()
    assert api.post(f"{P}/handoffs/h-r2-0001/rebroadcast").json() == {"rebroadcast": False}
    assert api.post(f"{P}/handoffs/h-r2-0001/rebroadcast", json={"settle": True}).json() == {"rebroadcast": True}
    assert [e for e, _ in api.events] == ["handoff"]
    api.post(f"{P}/handoffs/h-r2-0001/settled", json={"v": 1, "handoffId": "h-r2-0001", "batchId": "b1", "delivered": True})
    assert api.post(f"{P}/handoffs/h-r2-0001/rebroadcast", json={"settle": True}).json() == {"rebroadcast": False}


# -- R3 (ADR 0007 §3): the real final word is never undone by a late intermediate event -------------
def _receipt(api, it, **extra):
    return api.post(f"{P}/handoffs/h-r2-0001/receipt", json={"v": 1, "handoffId": "h-r2-0001", "accepted": [it["id"]], "batchId": "b1", **extra})


FAIL = {"v": 1, "handoffId": "h-r2-0001", "batchId": "b1", "delivered": False, "reason": "turn-error"}


def test_xr3_01_a_late_batch_sent_does_not_undo_a_real_failure(api):
    it, origin = _sent_handoff(api)
    _receipt(api, it)
    api.post(f"{P}/handoffs/h-r2-0001/settled", json=FAIL)
    assert _item(api)["status"] == "pending"
    api.post(f"{P}/events/batch-sent", json={"v": 1, "batchId": "b1", "sessionId": "s1", "items": [{"origin": origin}]})
    now = _item(api)
    assert now["status"] == "pending" and now["sentSessions"] == []
    assert now["queued"]["sendNow"] is False, "still 已在待发列表"
    # and a late batch.answered of the same batch does not either
    api.post(f"{P}/events/batch-answered", json={"v": 1, "batchId": "b1", "answered": [{"origin": origin}]})
    assert _item(api)["status"] == "pending"


def test_xr3_01_a_late_receipt_does_not_put_a_failed_handoff_back_to_waiting(api):
    it, _ = _sent_handoff(api)
    api.post(f"{P}/handoffs/h-r2-0001/settled", json=FAIL)
    before = _item(api)
    assert before["queued"]["sendNow"] is False
    _receipt(api, it)
    after = _item(api)
    assert after["queued"] == before["queued"], "no batchId: not 已提交，等待确认 again"
    assert api.get(f"{P}/handoffs/h-r2-0001").json()["receipt"]["batchId"] == "b1", "the receipt itself is kept"


def test_a_batch_sent_of_another_batch_still_moves_the_item(api):
    it, origin = _sent_handoff(api)
    _receipt(api, it)
    api.post(f"{P}/handoffs/h-r2-0001/settled", json=FAIL)
    api.post(f"{P}/events/batch-sent", json={"v": 1, "batchId": "b2", "sessionId": "s1", "items": [{"origin": origin}]})
    assert _item(api)["status"] == "sent", "sent again from the chat: a new batch"


def test_an_inferred_result_is_refused_when_the_receiver_declared_settles(api):
    it, _ = _sent_handoff(api)
    _receipt(api, it, settles=True)
    api.post(f"{P}/handoffs/h-r2-0001/settled", json={"v": 1, "handoffId": "h-r2-0001", "batchId": "b1", "delivered": True, "inferred": "batch.sent"})
    assert api.get(f"{P}/handoffs/h-r2-0001").json()["settled"] is None
    assert _item(api)["status"] == "pending"
    api.post(f"{P}/handoffs/h-r2-0001/settled", json=FAIL)
    assert api.get(f"{P}/handoffs/h-r2-0001").json()["settled"]["delivered"] is False


def test_a_real_failure_after_an_inferred_success_from_a_legacy_receiver_corrects_the_item(api):
    it, origin = _sent_handoff(api)
    _receipt(api, it)  # no settles: a legacy receiver
    api.post(f"{P}/events/batch-sent", json={"v": 1, "batchId": "b1", "sessionId": "s1", "items": [{"origin": origin}]})
    api.post(f"{P}/handoffs/h-r2-0001/settled", json={"v": 1, "handoffId": "h-r2-0001", "batchId": "b1", "delivered": True, "inferred": "batch.sent"})
    assert _item(api)["status"] == "sent"
    api.post(f"{P}/handoffs/h-r2-0001/settled", json=FAIL)
    assert _item(api)["status"] == "pending"
    # the real word stays: a late batch.sent changes nothing now
    api.post(f"{P}/events/batch-sent", json={"v": 1, "batchId": "b1", "sessionId": "s1", "items": [{"origin": origin}]})
    assert _item(api)["status"] == "pending"


def test_xr3_03_two_handoffs_in_one_batch_are_settled_each_on_its_own_items(api):
    a = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": A, "comment": "a"}).json()
    anchor_b = {**A, "exact": "original", "prefix": "", "suffix": ""}
    b = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": anchor_b, "comment": "b"}).json()
    for hid, it in (("h-q1-0001", a), ("h-q2-0001", b)):
        o = {"plugin": "diple-docs", "itemId": it["id"], "revision": it["revision"], "path": "/work/case.md", "line": 1}
        api.post(f"{P}/handoffs", json={"v": 1, "handoffId": hid, "targetSessionId": "s1", "sendNow": True, "items": [{"origin": o, "text": "x", "comment": ""}]})
        api.post(f"{P}/handoffs/{hid}/receipt", json={"v": 1, "handoffId": hid, "accepted": [it["id"]], "queued": True, "settles": True})
    for hid in ("h-q1-0001", "h-q2-0001"):
        r = api.post(f"{P}/handoffs/{hid}/settled", json={"v": 1, "handoffId": hid, "batchId": "b40", "delivered": False, "reason": "turn-error"}).json()
        assert len(r["touched"]) == 1
    items = {x["id"]: x for x in api.get(f"{P}/items", params={"path": "/work/case.md"}).json()["items"]}
    assert items[a["id"]]["status"] == items[b["id"]]["status"] == "pending"
