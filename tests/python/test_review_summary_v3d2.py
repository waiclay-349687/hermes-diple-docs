"""Diple Docs backend (V3-D2 P2): POST /items/summary — the transcript cards' one
coalesced, read-only request (the startup storm fix: dozens of GET /items in one
millisecond became one call)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import REPO, load_api_module

PLUGIN_DIR = REPO / "plugins" / "diple-docs" / "python"
P = "/api/plugins/diple-docs"


@pytest.fixture
def api(hermes_home, monkeypatch):
    mod = load_api_module(PLUGIN_DIR, "diple-docs", "hermes_diple_docs_api_summary")
    monkeypatch.setattr(mod, "_broadcast", lambda e, p: None)
    app = FastAPI()
    app.include_router(mod.router, prefix=P)
    return TestClient(app)


def add(api, path, text, line=1):
    r = api.post(f"{P}/items", json={"path": path, "anchor": {"text": text, "before": "", "after": "", "line": line}})
    assert r.status_code == 200, r.text
    return r.json()


def test_summary_counts_each_path_in_one_call(api, tmp_path):
    a, b = str(tmp_path / "a.md"), str(tmp_path / "b.md")
    i1 = add(api, a, "one")
    add(api, a, "two", 2)
    i3 = add(api, a, "three", 3)
    api.patch(f"{P}/items/{i1['id']}", json={"op": "resolve"})
    api.post(f"{P}/items/locate", json={"path": a, "results": [{"id": i3["id"], "lost": True}]})
    add(api, b, "only")
    empty = str(tmp_path / "none.md")

    r = api.post(f"{P}/items/summary", json={"paths": [a, b, empty, a]})
    assert r.status_code == 200, r.text
    c = r.json()["counts"]
    assert set(c) == {a, b, empty}
    assert c[a]["total"] == 3 and c[a]["open"] == 2
    assert c[a]["byStatus"] == {"pending": 2, "sent": 0, "answered": 0, "resolved": 1}
    assert c[a]["lost"] == 1
    assert c[b] == {"total": 1, "open": 1, "byStatus": {"pending": 1, "sent": 0, "answered": 0, "resolved": 0}, "lost": 0,
                    "itemsVersion": c[b]["itemsVersion"]}
    assert c[empty]["total"] == 0 and c[empty]["open"] == 0


def test_summary_reports_bad_paths_per_entry_not_as_a_failed_call(api, tmp_path):
    good = str(tmp_path / "a.md")
    r = api.post(f"{P}/items/summary", json={"paths": [good, "/x/notes.txt", "relative.md", ""]})
    assert r.status_code == 200
    c = r.json()["counts"]
    assert c[good]["total"] == 0
    assert c["/x/notes.txt"] == {"error": "unsupported-suffix"}
    assert c["relative.md"] == {"error": "path-not-absolute"}
    assert c[""] == {"error": "path-required"}


def test_summary_keys_answer_the_path_as_sent(api, tmp_path):
    """The card asked for `a/../b.md`; it must find its answer under that key."""
    raw = str(tmp_path / "x" / ".." / "b.md")
    add(api, str(tmp_path / "b.md"), "t")
    c = api.post(f"{P}/items/summary", json={"paths": [raw]}).json()["counts"]
    assert c[raw]["total"] == 1


def test_summary_is_bounded_and_validates_the_body(api, tmp_path):
    assert api.post(f"{P}/items/summary", json={}).status_code == 400
    assert api.post(f"{P}/items/summary", json={"paths": "nope"}).status_code == 400
    many = [str(tmp_path / f"d{i}.md") for i in range(201)]
    assert api.post(f"{P}/items/summary", json={"paths": many}).status_code == 413
    assert api.post(f"{P}/items/summary", json={"paths": many[:200]}).status_code == 200
