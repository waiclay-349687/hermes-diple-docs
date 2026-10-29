"""Diple Docs backend (R11 XR11-09): the request journal the real-app click matrix counts with.

Off by default (the route answers 404 and nothing is kept); with DIPLE_DOCS_JOURNAL=1 every
non-GET request is kept in order with its route and body, so a doubled POST shows even
when the store de-duplicates it.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import REPO, load_api_module

PLUGIN_DIR = REPO / "plugins" / "diple-docs" / "python"
P = "/api/plugins/diple-docs"


def make(monkeypatch, on):
    if on:
        monkeypatch.setenv("DIPLE_DOCS_JOURNAL", "1")
    else:
        monkeypatch.delenv("DIPLE_DOCS_JOURNAL", raising=False)
    mod = load_api_module(PLUGIN_DIR, "diple-docs", "hermes_diple_docs_api_store")
    monkeypatch.setattr(mod, "_broadcast", lambda e, p: None)
    app = FastAPI()
    app.include_router(mod.router, prefix=P)
    return TestClient(app)


@pytest.fixture
def doc(tmp_path):
    d = tmp_path / "plan.md"
    d.write_text("# 计划\n\n一段。\n\n二段。\n", encoding="utf-8")
    return d


def add(api, doc, comment=""):
    return api.post(f"{P}/items", json={"path": str(doc), "anchor": {"text": "一段。", "before": "", "after": "", "line": 3}, "comment": comment})


def test_off_by_default(hermes_home, monkeypatch, doc):
    api = make(monkeypatch, False)
    assert add(api, doc).status_code == 200
    assert api.get(f"{P}/debug/journal").status_code == 404


def test_a_deduplicated_double_post_still_shows_twice(hermes_home, monkeypatch, doc):
    api = make(monkeypatch, True)
    since = api.get(f"{P}/debug/journal").json()["seq"]
    first = add(api, doc, "意见").json()
    again = add(api, doc, "意见").json()
    assert again["duplicate"] is True and again["id"] == first["id"]
    api.get(f"{P}/items", params={"path": str(doc)})  # reads are not kept
    api.patch(f"{P}/items/{first['id']}", json={"op": "resolve", "expectMutation": first["mutation"]})
    j = api.get(f"{P}/debug/journal", params={"since": since}).json()
    assert [(e["method"], e["route"]) for e in j["entries"]] == [("POST", "/items"), ("POST", "/items"), ("PATCH", f"/items/{first['id']}")]
    assert j["entries"][0]["body"]["comment"] == "意见"
    assert api.get(f"{P}/debug/journal", params={"since": j["seq"]}).json()["entries"] == []
