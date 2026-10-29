"""fix-r4 — R4 XE4-02, Review backend half: a settled with per-item results
(`items`) marks only the items that really went out as sent. An item that
never rode in the batch ('removed' / 'replaced' in Diple) goes back to
pending and is no longer shown as waiting in a session's list."""

from __future__ import annotations

from test_review_r2 import A, P, api  # noqa: F401  (fixtures)


def _two(api, hid="h-r4-0001"):
    a = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": A, "comment": "a"}).json()
    anchor_b = {"text": "second", "before": "", "after": "", "line": 2}
    b = api.post(f"{P}/items", json={"path": "/work/case.md", "anchor": anchor_b, "comment": "b"}).json()
    items = [{"origin": {"plugin": "diple-docs", "itemId": it["id"], "revision": it["revision"], "path": "/work/case.md", "line": 1},
              "text": "x", "comment": ""} for it in (a, b)]
    api.post(f"{P}/handoffs", json={"v": 1, "handoffId": hid, "targetSessionId": "s1", "sendNow": True, "items": items})
    api.post(f"{P}/handoffs/{hid}/receipt", json={"v": 1, "handoffId": hid, "accepted": [a["id"], b["id"]], "queued": True, "settles": True})
    return a, b


def _items(api):
    return {x["id"]: x for x in api.get(f"{P}/items", params={"path": "/work/case.md"}).json()["items"]}


def test_xe4_02_partial_settled_marks_only_the_items_that_went_out(api):
    a, b = _two(api)
    body = {"v": 1, "handoffId": "h-r4-0001", "batchId": "bQ1", "delivered": True,
            "items": [{"itemId": a["id"], "delivered": True}, {"itemId": b["id"], "delivered": False, "reason": "removed"}]}
    r = api.post(f"{P}/handoffs/h-r4-0001/settled", json=body).json()
    assert sorted(r["touched"]) == sorted([a["id"], b["id"]])
    now = _items(api)
    assert now[a["id"]]["status"] == "sent"
    assert now[b["id"]]["status"] == "pending"
    assert now[b["id"]]["queued"] is None, "removed in Diple: not waiting in a session's list"
    assert now[b["id"]]["sentSessions"] == []
    stored = api.get(f"{P}/handoffs/h-r4-0001").json()["settled"]
    assert stored["items"][1] == {"itemId": b["id"], "delivered": False, "reason": "removed"}


def test_xe4_02_nothing_went_out_removed_is_not_sent(api):
    a, b = _two(api)
    body = {"v": 1, "handoffId": "h-r4-0001", "batchId": "bQ1", "delivered": False, "reason": "removed",
            "items": [{"itemId": a["id"], "delivered": False, "reason": "removed"}, {"itemId": b["id"], "delivered": False, "reason": "replaced"}]}
    api.post(f"{P}/handoffs/h-r4-0001/settled", json=body)
    now = _items(api)
    assert {now[a["id"]]["status"], now[b["id"]]["status"]} == {"pending"}
    assert now[a["id"]]["queued"] is None and now[b["id"]]["queued"] is None


def test_xe4_02_settled_without_items_from_an_older_diple_still_works(api):
    a, b = _two(api)
    api.post(f"{P}/handoffs/h-r4-0001/settled", json={"v": 1, "handoffId": "h-r4-0001", "batchId": "bQ1", "delivered": True})
    assert {x["status"] for x in _items(api).values()} == {"sent"}


def test_xe4_02_items_validation(api):
    _two(api)
    bad = {"v": 1, "handoffId": "h-r4-0001", "delivered": True, "items": [{"itemId": 3, "delivered": True}]}
    assert api.post(f"{P}/handoffs/h-r4-0001/settled", json=bad).status_code == 400
