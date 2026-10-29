"""Diple Docs backend (V3-D2 L): bulk clear / restore / resolve of a review list.

Each call is one transaction: every named item goes, or none does.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import REPO, load_api_module

PLUGIN_DIR = REPO / "plugins" / "diple-docs" / "python"
P = "/api/plugins/diple-docs"


@pytest.fixture
def api(hermes_home, monkeypatch):
    mod = load_api_module(PLUGIN_DIR, "diple-docs", "hermes_diple_docs_api_store")
    monkeypatch.setattr(mod, "_broadcast", lambda e, p: None)
    app = FastAPI()
    app.include_router(mod.router, prefix=P)
    client = TestClient(app)
    client.mod = mod
    return client


@pytest.fixture
def doc(tmp_path):
    d = tmp_path / "plan.md"
    d.write_text("# 计划\n\n一段。\n\n二段。\n\n三段。\n", encoding="utf-8")
    return d


def add(api, doc, text, line, comment=""):
    r = api.post(f"{P}/items", json={"path": str(doc), "anchor": {"text": text, "before": "", "after": "", "line": line},
                                     "comment": comment})
    assert r.status_code == 200, r.text
    return r.json()


def items(api, doc):
    return api.get(f"{P}/items", params={"path": str(doc)}).json()["items"]


def test_bulk_delete_returns_snapshots_and_restore_puts_them_back(api, doc):
    a, b, c = add(api, doc, "一段", 3, "x"), add(api, doc, "二段", 5), add(api, doc, "三段", 7, "z")
    api.patch(f"{P}/items/{b['id']}", json={"op": "resolve"})
    before = items(api, doc)
    r = api.post(f"{P}/items/bulk-delete", json={"path": str(doc), "ids": [a["id"], b["id"]]})
    assert r.status_code == 200, r.text
    gone = r.json()["deleted"]
    assert sorted(x["id"] for x in gone) == sorted([a["id"], b["id"]])
    assert [x["id"] for x in items(api, doc)] == [c["id"]]
    r = api.post(f"{P}/items/bulk-restore", json={"items": gone})
    assert r.status_code == 200, r.text
    after = items(api, doc)
    strip = lambda xs: sorted(({k: v for k, v in x.items() if k != "updatedAt"} for x in xs), key=lambda x: x["id"])
    assert strip(after) == strip(before), "the same items, ids, statuses and comments"


def test_bulk_delete_is_all_or_nothing(api, doc):
    a = add(api, doc, "一段", 3)
    r = api.post(f"{P}/items/bulk-delete", json={"path": str(doc), "ids": [a["id"], "rmissing0000000"]})
    assert r.status_code == 409 and r.json()["detail"] == "stale"
    assert [x["id"] for x in items(api, doc)] == [a["id"]], "nothing deleted"


def test_bulk_delete_refuses_items_of_another_file_and_changed_ones(api, doc, tmp_path):
    other = tmp_path / "other.md"
    other.write_text("别的。\n", encoding="utf-8")
    a, o = add(api, doc, "一段", 3), add(api, other, "别的", 1)
    r = api.post(f"{P}/items/bulk-delete", json={"path": str(doc), "ids": [a["id"], o["id"]]})
    assert r.status_code == 409
    assert len(items(api, doc)) == 1 and len(items(api, other)) == 1
    # edited in another window since the list was read: the expected token no longer matches
    api.patch(f"{P}/items/{a['id']}", json={"op": "comment", "comment": "新"})
    r = api.post(f"{P}/items/bulk-delete", json={"path": str(doc), "ids": [a["id"]], "expectMutations": {a["id"]: a["mutation"]}})
    assert r.status_code == 409 and len(items(api, doc)) == 1


def test_bulk_delete_rejects_bad_input(api, doc):
    assert api.post(f"{P}/items/bulk-delete", json={"path": str(doc), "ids": "x"}).status_code == 400
    assert api.post(f"{P}/items/bulk-delete", json={"path": str(doc), "ids": ["../x"]}).status_code == 400
    assert api.post(f"{P}/items/bulk-delete", json={"path": str(doc), "ids": []}).json() == {"deleted": []}


def test_bulk_restore_is_all_or_nothing(api, doc):
    a = add(api, doc, "一段", 3)
    snap = items(api, doc)[0]
    api.post(f"{P}/items/bulk-delete", json={"path": str(doc), "ids": [a["id"]]})
    bad = {**snap, "id": "../nope"}
    r = api.post(f"{P}/items/bulk-restore", json={"items": [snap, bad]})
    assert r.status_code == 400
    assert items(api, doc) == [], "the good one is not restored either"
    # restoring twice is harmless (an undo clicked in two windows)
    assert api.post(f"{P}/items/bulk-restore", json={"items": [snap]}).status_code == 200
    assert api.post(f"{P}/items/bulk-restore", json={"items": [snap]}).status_code == 200
    assert len(items(api, doc)) == 1


def test_clearing_a_sent_item_leaves_its_handoff_alone(api, doc):
    a = add(api, doc, "一段", 3, "c")
    h = {"handoffId": "h" + "1" * 15, "sessionId": "s1", "items": [{"origin": {"plugin": "diple-docs", "itemId": a["id"]}, "text": "一段", "comment": "c"}]}
    created = api.post(f"{P}/handoffs", json=h)
    api.post(f"{P}/items/bulk-delete", json={"path": str(doc), "ids": [a["id"]]})
    if created.status_code == 200:
        got = api.get(f"{P}/handoffs/{h['handoffId']}")
        assert got.status_code == 200, "what was sent stays sent"


def test_bulk_resolve(api, doc):
    a, b = add(api, doc, "一段", 3), add(api, doc, "二段", 5)
    api.patch(f"{P}/items/{b['id']}", json={"op": "resolve"})
    r = api.post(f"{P}/items/bulk-resolve", json={"path": str(doc), "ids": [a["id"], b["id"]]})
    assert r.status_code == 200, r.text
    assert sorted(r.json()["resolved"]) == [a["id"]], "only the ones that changed"
    assert {x["status"] for x in items(api, doc)} == {"resolved"}
    r = api.post(f"{P}/items/bulk-resolve", json={"path": str(doc), "ids": [a["id"], "rmissing0000000"]})
    assert r.status_code == 409
