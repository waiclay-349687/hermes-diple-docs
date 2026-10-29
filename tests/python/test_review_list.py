"""Diple Docs backend (W2c): the review list's state machine, events, hand-off receipts, the card hooks.

Each test names the spec user story it covers (S45…S62).
"""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import REPO, load_api_module, load_plugin_package

PLUGIN_DIR = REPO / "plugins" / "diple-docs" / "python"
P = "/api/plugins/diple-docs"


@pytest.fixture
def api(hermes_home, monkeypatch):
    mod = load_api_module(PLUGIN_DIR, "diple-docs", "hermes_diple_docs_api_store")
    events = []
    monkeypatch.setattr(mod, "_broadcast", lambda e, p: events.append((e, p)))
    app = FastAPI()
    app.include_router(mod.router, prefix=P)
    client = TestClient(app)
    client.events = events
    client.mod = mod
    return client


@pytest.fixture
def doc(tmp_path):
    d = tmp_path / "plan.md"
    d.write_text("# 计划\n\n先更新数据库，再删除缓存。\n\n第二段。\n", encoding="utf-8")
    return d


def anchor(text="先更新数据库", line=3, before="# 计划\n\n", after="，再删除缓存。"):
    return {"text": text, "before": before, "after": after, "line": line}


def add(api, doc, **kw):
    r = api.post(f"{P}/items", json={"path": str(doc), "anchor": kw.pop("anchor", anchor()), **kw})
    assert r.status_code == 200, r.text
    return r.json()


def patch(api, item, op, **body):
    r = api.patch(f"{P}/items/{item['id']}", json={"op": op, **body})
    assert r.status_code == 200, r.text
    return r.json()


def items(api, doc):
    return api.get(f"{P}/items", params={"path": str(doc)}).json()["items"]


def origin(item, revision=None, path="/x.md"):
    return {"origin": {"plugin": "diple-docs", "itemId": item["id"],
                       "revision": item["revision"] if revision is None else revision, "path": path, "line": 3}}


def sent(api, item, batch="b1", session="local-s1", revision=None):
    return api.post(f"{P}/events/batch-sent", json={"v": 1, "batchId": batch, "sessionId": session,
                                                    "items": [origin(item, revision)]}).json()


def answered(api, item, batch="b1", revision=None):
    return api.post(f"{P}/events/batch-answered", json={"v": 1, "batchId": batch,
                                                        "answered": [origin(item, revision)]}).json()


# -- S51/S61: the list belongs to the file, lives in plugin SQLite, survives sends ----------
def test_s51_items_are_kept_per_file_and_survive_sending(api, doc, tmp_path):
    other = tmp_path / "other.markdown"
    other.write_text("x", encoding="utf-8")
    a = add(api, doc, comment="为什么？")
    add(api, other, anchor=anchor(text="x", line=1, before="", after=""))
    assert [i["id"] for i in items(api, doc)] == [a["id"]]
    sent(api, a)
    assert items(api, doc)[0]["status"] == "sent"  # sending never empties the list


def test_s61_no_sidecar_file_is_written_next_to_the_document(api, doc):
    before = sorted(p.name for p in doc.parent.iterdir())
    a = add(api, doc, comment="c")
    patch(api, a, "comment", comment="d")
    api.post(f"{P}/items/locate", json={"path": str(doc), "results": [{"id": a["id"], "lost": True}]})
    assert sorted(p.name for p in doc.parent.iterdir()) == before


def test_s45_only_md_and_markdown_have_review_lists(api, tmp_path):
    txt = tmp_path / "notes.txt"
    txt.write_text("x", encoding="utf-8")
    assert api.post(f"{P}/items", json={"path": str(txt), "anchor": anchor()}).status_code == 415
    assert api.get(f"{P}/items", params={"path": str(txt)}).status_code == 415
    assert api.get(f"{P}/review/state", params={"path": str(txt)}).status_code == 415
    assert api.get(f"{P}/items", params={"path": "rel/plan.md"}).status_code == 400


def test_s49_same_original_at_same_line_is_one_item(api, doc):
    a = add(api, doc)
    b = add(api, doc)
    assert b["duplicate"] is True and b["id"] == a["id"]
    assert len(items(api, doc)) == 1


def test_s49_rejects_an_empty_anchor(api, doc):
    r = api.post(f"{P}/items", json={"path": str(doc), "anchor": {"text": "  ", "line": 1}})
    assert r.status_code == 400 and r.json()["detail"] == "anchor-required"


# -- S53/S54: status machine with revision checks -----------------------------------------------
def test_s53_pending_sent_answered_and_sessions_are_recorded(api, doc):
    a = add(api, doc, comment="意见")
    assert a["status"] == "pending" and a["revision"] == 1
    sent(api, a, batch="b1", session="local-s1")
    i = items(api, doc)[0]
    assert i["status"] == "sent"
    assert [(s["sessionId"], s["batchId"]) for s in i["sentSessions"]] == [("local-s1", "b1")]
    answered(api, a)
    assert items(api, doc)[0]["status"] == "answered"


def test_s54_late_answer_to_an_older_revision_does_not_overwrite_a_new_edit(api, doc):
    a = add(api, doc, comment="v1")
    sent(api, a)
    edited = patch(api, a, "comment", comment="v2")
    assert edited["status"] == "pending" and edited["revision"] == 2
    assert answered(api, a, revision=1) == {"touched": []}
    assert items(api, doc)[0]["status"] == "pending"


def test_s54_resolved_is_only_set_and_cleared_by_the_user(api, doc):
    a = add(api, doc, comment="c")
    sent(api, a)
    patch(api, a, "resolve")
    assert answered(api, a) == {"touched": []}
    assert sent(api, a, batch="b2")["touched"] == [a["id"]]  # session history still recorded
    i = items(api, doc)[0]
    assert i["status"] == "resolved" and len(i["sentSessions"]) == 2


def test_s55_editing_a_sent_or_answered_comment_returns_it_to_pending(api, doc):
    a = add(api, doc, comment="c")
    sent(api, a)
    answered(api, a)
    same = patch(api, a, "comment", comment="c")  # no change, no new revision
    assert same["status"] == "answered" and same["revision"] == 1
    b = patch(api, a, "comment", comment="c2")
    assert (b["status"], b["revision"]) == ("pending", 2)


def test_s55_reopen_a_resolved_item(api, doc):
    a = add(api, doc, comment="c")
    sent(api, a)
    answered(api, a)
    r = patch(api, a, "resolve")
    assert r["status"] == "resolved"
    o = patch(api, a, "reopen")
    assert (o["status"], o["revision"]) == ("pending", 2)
    assert answered(api, a, revision=1) == {"touched": []}


def test_stale_edit_from_another_window_is_rejected(api, doc):
    a = add(api, doc, comment="c")
    patch(api, a, "comment", comment="d")
    r = api.patch(f"{P}/items/{a['id']}", json={"op": "comment", "comment": "e", "expectRevision": 1})
    assert r.status_code == 409 and r.json()["detail"] == "stale"


def test_events_ignore_other_plugins_and_bad_versions(api, doc):
    a = add(api, doc)
    foreign = {"v": 1, "batchId": "b1", "sessionId": "s",
               "items": [{"origin": {"plugin": "diple", "itemId": a["id"], "revision": 1}}]}
    assert api.post(f"{P}/events/batch-sent", json=foreign).json() == {"touched": []}
    assert api.post(f"{P}/events/batch-sent", json={"v": 2, "items": []}).status_code == 400
    assert items(api, doc)[0]["status"] == "pending"


# -- S58: relocation results; "changed" is a flag over the lifecycle ----------------------------
def test_s58_lost_then_found_again_keeps_the_lifecycle_status(api, doc):
    a = add(api, doc, comment="c")
    sent(api, a)
    r = api.post(f"{P}/items/locate", json={"path": str(doc), "results": [{"id": a["id"], "lost": True}]})
    assert r.json() == {"changed": 1}
    i = items(api, doc)[0]
    assert i["lost"] is True and i["status"] == "sent"
    moved = anchor(line=7, before="新的一段\n\n")
    api.post(f"{P}/items/locate", json={"path": str(doc), "results": [{"id": a["id"], "anchor": moved}]})
    i = items(api, doc)[0]
    assert i["lost"] is False and i["anchor"]["line"] == 7 and i["status"] == "sent"


def test_s58_relocation_is_idempotent_and_never_changes_the_original(api, doc):
    a = add(api, doc)
    v0 = api.get(f"{P}/review/state", params={"path": str(doc)}).json()["itemsVersion"]
    same = {"path": str(doc), "results": [{"id": a["id"], "anchor": anchor()}]}
    assert api.post(f"{P}/items/locate", json=same).json() == {"changed": 0}
    assert api.get(f"{P}/review/state", params={"path": str(doc)}).json()["itemsVersion"] == v0
    other = {"path": str(doc), "results": [{"id": a["id"], "anchor": anchor(text="别的文字")}]}
    assert api.post(f"{P}/items/locate", json=other).json() == {"changed": 0}


def test_s58_replace_the_original_of_a_changed_item(api, doc):
    a = add(api, doc, comment="c")
    api.post(f"{P}/items/locate", json={"path": str(doc), "results": [{"id": a["id"], "lost": True}]})
    r = patch(api, a, "replace", anchor=anchor(text="第二段", line=5, before="\n\n", after="。\n"))
    assert (r["text"], r["lost"], r["status"], r["revision"], r["comment"]) == ("第二段", False, "pending", 2, "c")


def test_delete_and_undo_restore_the_same_item(api, doc):
    a = add(api, doc, comment="c")
    sent(api, a)
    snap = items(api, doc)[0]
    assert api.delete(f"{P}/items/{a['id']}").json() == {"deleted": True}
    assert items(api, doc) == []
    back = api.post(f"{P}/items/restore", json=snap).json()
    assert (back["id"], back["status"], back["comment"], back["sentSessions"]) == (a["id"], "sent", "c", snap["sentSessions"])


# -- S58/S59: one cheap poll for file + list --------------------------------------------------
def test_review_state_reports_mtime_and_list_version(api, doc):
    s0 = api.get(f"{P}/review/state", params={"path": str(doc)}).json()
    assert s0["exists"] is True and s0["mtime"] == doc.stat().st_mtime
    add(api, doc)
    s1 = api.get(f"{P}/review/state", params={"path": str(doc)}).json()
    assert s1["itemsVersion"] != s0["itemsVersion"]
    doc.unlink()
    s2 = api.get(f"{P}/review/state", params={"path": str(doc)}).json()
    assert s2["exists"] is False and s2["error"] == "not-found" and s2["itemsVersion"] == s1["itemsVersion"]


# -- S47: recent reviews ----------------------------------------------------------------------------
def test_s47_recent_reviews_count_open_items_and_can_be_forgotten(api, doc):
    api.get(f"{P}/file", params={"path": str(doc)})
    a = add(api, doc)
    add(api, doc, anchor=anchor(text="第二段", line=5))
    patch(api, a, "resolve")
    rec = api.get(f"{P}/reviews/recent").json()["reviews"]
    assert rec == [{"path": str(doc), "lastOpenedAt": rec[0]["lastOpenedAt"], "openItems": 1, "items": 2}]
    api.delete(f"{P}/reviews/recent", params={"path": str(doc)})
    assert api.get(f"{P}/reviews/recent").json()["reviews"] == []


# -- S52/S62: hand-off receipts, cancel, rebroadcast -------------------------------------------------
def handoff_for(item, hid="h-0002", send_now=False):
    return {"v": 1, "handoffId": hid, "targetSessionId": "local-s1", "sendNow": send_now,
            "items": [{"origin": {"plugin": "diple-docs", "itemId": item["id"], "revision": item["revision"],
                                  "path": item["path"], "line": item["anchor"]["line"]},
                       "text": item["text"], "comment": item["comment"]}]}


def test_s52_receipt_marks_accepted_items_as_queued_for_that_session(api, doc):
    a = add(api, doc, comment="c")
    api.post(f"{P}/handoffs", json=handoff_for(a))
    api.post(f"{P}/handoffs/h-0002/receipt", json={"v": 1, "handoffId": "h-0002", "accepted": [a["id"]]})
    q = items(api, doc)[0]["queued"]
    assert (q["sessionId"], q["revision"], q["sendNow"]) == ("local-s1", 1, False)
    sent(api, a)
    i = items(api, doc)[0]
    assert i["status"] == "sent" and i["queued"] is None


def test_s52_queued_copy_is_stale_after_an_edit(api, doc):
    a = add(api, doc, comment="c")
    api.post(f"{P}/handoffs", json=handoff_for(a))
    api.post(f"{P}/handoffs/h-0002/receipt", json={"v": 1, "handoffId": "h-0002", "accepted": [a["id"]]})
    e = patch(api, a, "comment", comment="c2")
    assert e["queued"] is None and e["revision"] == 2
    sent(api, a, revision=1)  # the old copy goes out: history recorded, status stays pending
    i = items(api, doc)[0]
    assert i["status"] == "pending" and len(i["sentSessions"]) == 1


def test_s62_cancelled_handoffs_are_not_rebroadcast_but_a_late_receipt_still_counts(api, doc):
    a = add(api, doc)
    api.post(f"{P}/handoffs", json=handoff_for(a))
    api.post(f"{P}/handoffs", json=handoff_for(a, hid="h-0003"))
    api.post(f"{P}/handoffs/h-0002/cancel")
    api.events.clear()
    assert api.post(f"{P}/handoffs/rebroadcast-pending").json() == {"rebroadcast": ["h-0003"]}
    assert [e for e, _ in api.events] == ["handoff"]
    assert api.post(f"{P}/handoffs/h-0002/rebroadcast").json() == {"rebroadcast": False}
    api.post(f"{P}/handoffs/h-0002/receipt", json={"v": 1, "handoffId": "h-0002", "accepted": [a["id"]]})
    assert items(api, doc)[0]["queued"]["sessionId"] == "local-s1"


def test_settings_mirror(api):
    assert api.get(f"{P}/settings").json() == {"autoCard": True}
    assert api.put(f"{P}/settings", json={"autoCard": False, "junk": 1}).json() == {"autoCard": False}
    assert api.put(f"{P}/settings", json={"autoCard": "no"}).json() == {"autoCard": False}


# -- S46: the "open review" card -----------------------------------------------------------------
@pytest.fixture
def pkg(hermes_home):
    return load_plugin_package(PLUGIN_DIR, "hermes_plugins_diple_docs_hooks")


def write_result(path):
    return json.dumps({"bytes_written": 10, "resolved_path": path, "files_modified": [path]})


def test_s46_card_is_appended_for_md_files_written_this_turn(pkg, tmp_path):
    md = str(tmp_path / "plan.md")
    mk = str(tmp_path / "notes.markdown")
    pkg.on_post_tool_call(tool_name="write_file", result=write_result(md), session_id="s1", turn_id="t1", status="ok")
    pkg.on_post_tool_call(tool_name="patch", result=write_result(mk), session_id="s1", turn_id="t1", status="ok")
    pkg.on_post_tool_call(tool_name="patch", result=write_result(md), session_id="s1", turn_id="t1", status="ok")
    pkg.on_post_tool_call(tool_name="write_file", result=write_result(str(tmp_path / "x.py")), session_id="s1",
                          turn_id="t1", status="ok")
    pkg.on_post_tool_call(tool_name="write_file", result=write_result(str(tmp_path / "other.md")), session_id="s2",
                          turn_id="t9", status="ok")
    recent = [r["path"] for r in pkg.store.store_for_current_home().recent_reviews()]
    assert md in recent and mk in recent  # reachable from ⌘K even if the card is lost
    out = pkg.on_transform_llm_output(response_text="写好了。", session_id="s1", turn_id="t1")
    assert out == f'写好了。\n\n::diple-docs{{path="{md}"}}\n\n::diple-docs{{path="{mk}"}}'
    assert pkg.on_transform_llm_output(response_text="again", session_id="s1", turn_id="t1") is None


@pytest.mark.parametrize("tool,result,status", [
    ("write_file", json.dumps({"error": "denied"}), "error"),
    ("write_file", json.dumps({"error": "denied"}), None),
    ("read_file", None, "ok"),
    ("terminal", None, "ok"),
    ("write_file", "not json", "ok"),
])
def test_s46_no_card_for_failed_or_unrelated_tools(pkg, tmp_path, tool, result, status):
    res = result if result is not None else write_result(str(tmp_path / "plan.md"))
    pkg.on_post_tool_call(tool_name=tool, result=res, session_id="s1", turn_id="t1", status=status)
    assert pkg.on_transform_llm_output(response_text="ok", session_id="s1", turn_id="t1") is None


def test_s46_card_can_be_switched_off(api, pkg, tmp_path):
    api.put(f"{P}/settings", json={"autoCard": False})
    md = str(tmp_path / "plan.md")
    pkg.on_post_tool_call(tool_name="write_file", result=write_result(md), session_id="s1", turn_id="t1", status="ok")
    assert pkg.on_transform_llm_output(response_text="ok", session_id="s1", turn_id="t1") is None


def test_s46_paths_are_quoted_safely_and_existing_cards_not_duplicated(pkg):
    store = pkg.store
    assert store.card_directive('/a/b "c".md') == "::diple-docs{path='/a/b \"c\".md'}"
    assert store.card_directive("/a/{b}.md") is None
    text = 'done\n\n::diple-docs{path="/a/p.md"}'
    assert store.append_cards(text, ["/a/p.md"]) is None


def test_s46_hook_errors_never_escape(pkg, monkeypatch):
    monkeypatch.setattr(pkg._store, "store_for_current_home", lambda: (_ for _ in ()).throw(RuntimeError("db")))
    assert pkg.on_post_tool_call(tool_name="write_file", result=write_result("/a/p.md"), status="ok") is None
    assert pkg.on_transform_llm_output(response_text="x", session_id="s", turn_id="t") is None


# -- XR-05: the anchor's document fingerprint is kept, junk is dropped --------------------------
def test_anchor_sig_is_stored_and_refreshed_by_relocation(api, doc):
    a = add(api, doc, anchor={**anchor(), "sig": "abc.1.2"})
    assert items(api, doc)[0]["anchor"]["sig"] == "abc.1.2"
    moved = {**anchor(), "sig": "abc.9.9"}
    assert api.post(f"{P}/items/locate", json={"path": str(doc), "results": [{"id": a["id"], "anchor": moved}]}).json() == {"changed": 1}
    assert items(api, doc)[0]["anchor"]["sig"] == "abc.9.9"
    b = add(api, doc, anchor={**anchor(text="第二段", line=5), "sig": "x" * 500})
    assert "sig" not in b["anchor"]


# -- XR-04: every user edit can name its base revision; last writer does not silently win ----------
@pytest.mark.parametrize("op,body", [("comment", {"comment": "B"}), ("resolve", {}),
                                     ("replace", {"anchor": anchor(text="第二段", line=5)})])
def test_edits_against_a_stale_revision_are_rejected_for_every_op(api, doc, op, body):
    a = add(api, doc, comment="c")
    patch(api, a, "comment", comment="A", expectRevision=1)
    r = api.patch(f"{P}/items/{a['id']}", json={"op": op, "expectRevision": 1, **body})
    assert r.status_code == 409 and r.json()["detail"] == "stale"
    i = items(api, doc)[0]
    assert (i["comment"], i["status"], i["revision"]) == ("A", "pending", 2)
    ok = api.patch(f"{P}/items/{a['id']}", json={"op": op, "expectRevision": 2, **body})
    assert ok.status_code == 200


def test_the_revision_check_is_part_of_the_update_itself(api, doc):
    store = api.mod._store_mod.store_for_current_home()
    a = add(api, doc, comment="c")
    real_get = store._get_row
    calls = {"n": 0}

    def racing_get(item_id):
        row = real_get(item_id)
        if calls["n"] == 0:  # another writer lands between our read and our write
            calls["n"] += 1
            store._conn.execute("UPDATE items SET revision = revision + 1, comment = 'other' WHERE id = ?", (item_id,))
            store._conn.commit()
        return row

    store._get_row = racing_get
    try:
        with pytest.raises(api.mod._store_mod.ItemError) as e:
            store.update_item(a["id"], "comment", comment="mine", expect_revision=1)
        assert e.value.code == "stale"
    finally:
        store._get_row = real_get
    assert items(api, doc)[0]["comment"] == "other"


# -- XR-03: hand-offs that timed out without a receipt are "unconfirmed", across windows/reloads ----
def test_unconfirmed_handoffs_are_listed_until_a_receipt_arrives(api, doc):
    a = add(api, doc)
    body = {"v": 1, "handoffId": "h-unconf-1", "targetSessionId": "s1", "sendNow": True, "items": [origin(a)]}
    assert api.post(f"{P}/handoffs", json=body).status_code == 200
    assert api.get(f"{P}/handoffs/unconfirmed").json() == {"handoffs": []}, "still waiting is not unconfirmed"
    api.post(f"{P}/handoffs/h-unconf-1/cancel")
    assert api.get(f"{P}/handoffs/unconfirmed").json() == {"handoffs": [{"handoffId": "h-unconf-1", "itemIds": [a["id"]]}]}
    api.post(f"{P}/handoffs/h-unconf-1/receipt", json={"v": 1, "handoffId": "h-unconf-1", "accepted": [a["id"]]})
    assert api.get(f"{P}/handoffs/unconfirmed").json() == {"handoffs": []}
    # the route does not shadow /handoffs/{id}
    assert api.get(f"{P}/handoffs/h-unconf-1").json()["handoffId"] == "h-unconf-1"


def test_dot_dot_spellings_of_a_path_share_one_review_list(api, doc):
    odd = str(doc.parent / "sub" / ".." / doc.name)
    (doc.parent / "sub").mkdir()
    add(api, doc)
    assert [i["text"] for i in api.get(f"{P}/items", params={"path": odd}).json()["items"]] == ["先更新数据库"]
    assert api.get(f"{P}/file", params={"path": odd}).json()["path"] == str(doc)
