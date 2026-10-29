"""fix-r6 — R6 XE6-01 across the layers: the Review sender's writes, replayed into the real
Review backend, leave the removed item pending.

An Diple that never settles; a hand-off of A and B; A is removed from the session's
pending list, so the batch carries B only. tests/desktop/legacy-partial-writes.mjs runs
the real createHandoff and returns every backend write it made, in order; they are
POSTed here, in that order, to the real Review routes over SQLite, and the list is read
back: A stays pending with no sent session, B is sent — on both legacy paths
(batch.answered; batch.sent + the quiet period).
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import load_api_module

ROOT = Path(__file__).resolve().parents[2]
PATH = "/work/legacy.md"


@pytest.fixture()
def review(hermes_home):
    api = load_api_module(ROOT / "plugins/diple-docs/python", "diple-docs", "hermes_diple_docs_api_store_r6")
    store = api._store_mod.ReviewStore(connect=lambda: sqlite3.connect(":memory:", check_same_thread=False))
    api.get_store = lambda: store
    api._broadcast = lambda *a, **k: None
    app = FastAPI()
    app.include_router(api.router, prefix="/r")
    return store, TestClient(app)


def _writes(spec: dict) -> dict:
    node = shutil.which("node") or ""
    if not node:
        pytest.skip("node is needed for the JS half")
    out = subprocess.run([node, str(ROOT / "tests/desktop/legacy-partial-writes.mjs"), json.dumps(spec)],
                         check=True, capture_output=True, text=True, timeout=60, cwd=ROOT)
    return json.loads(out.stdout)


def _replay(store, client, spec):
    wire = _writes(spec)
    store.save_handoff(wire["payload"])
    for w in wire["writes"]:
        r = client.post("/r" + w["path"], json=w["body"])
        assert r.status_code == 200, (w, r.text)
    items = {x["id"]: x for x in client.get("/r/items", params={"path": PATH}).json()["items"]}
    return wire, items


@pytest.mark.parametrize("variant", ["answered", "fallback"])
def test_removed_item_stays_pending(review, variant):
    store, client = review
    a, b = (store.add_item(PATH, {"text": t, "line": i + 1}, t) for i, t in enumerate(["removed", "really sent"]))
    wire, items = _replay(store, client, {"ids": [a["id"], b["id"]], "variant": variant})
    # told: B only
    assert wire["notices"][-1] == {"ok": True, "outcome": "sent", "accepted": [b["id"]], "missed": 1}
    # written and read back: the same — A pending, never in a sent session; B sent
    assert items[a["id"]]["status"] == "pending", items[a["id"]]
    assert not items[a["id"]]["sentSessions"], items[a["id"]]
    # B went out; batch.answered moves it one step further (sent → answered)
    assert items[b["id"]]["status"] == ("answered" if variant == "answered" else "sent"), items[b["id"]]
    assert [s["batchId"] for s in items[b["id"]]["sentSessions"]] == ["batchLegacyPartial"]
    settled = store.get_handoff(wire["payload"]["handoffId"])["settled"]
    assert settled["inferred"] == ("batch.answered" if variant == "answered" else "batch.sent")
    assert {x["itemId"]: x["delivered"] for x in settled["items"]} == {a["id"]: False, b["id"]: True}


def test_whole_hand_off_carried_marks_both_sent(review):
    store, client = review
    a, b = (store.add_item(PATH, {"text": t, "line": i + 1}, t) for i, t in enumerate(["one", "two"]))
    _, items = _replay(store, client, {"ids": [a["id"], b["id"]], "variant": "fallback", "carried": [a["id"], b["id"]]})
    assert items[a["id"]]["status"] == "sent" and items[b["id"]]["status"] == "sent"


def test_nothing_carried_puts_both_back_pending(review):
    """Batch events that carried none of this queued hand-off's items: nothing marked sent."""
    store, client = review
    a, b = (store.add_item(PATH, {"text": t, "line": i + 1}, t) for i, t in enumerate(["one", "two"]))
    other = store.add_item(PATH, {"text": "other", "line": 9}, "other")
    wire, items = _replay(store, client, {"ids": [a["id"], b["id"]], "variant": "fallback", "carried": [other["id"]]})
    assert all(n["outcome"] != "sent" for n in wire["notices"]), wire["notices"]
    for x in (a, b):
        assert items[x["id"]]["status"] == "pending" and not items[x["id"]]["sentSessions"], items[x["id"]]


def test_submitted_batch_carrying_none_records_removed(review):
    """A submitted hand-off whose batch events carried none of its items: the inferred
    conclusion is delivered:false, reason removed — shown and written alike."""
    store, client = review
    a, b = (store.add_item(PATH, {"text": t, "line": i + 1}, t) for i, t in enumerate(["one", "two"]))
    other = store.add_item(PATH, {"text": "other", "line": 9}, "other")
    wire, items = _replay(store, client, {"ids": [a["id"], b["id"]], "variant": "fallback", "carried": [other["id"]], "submitted": True})
    assert wire["notices"][-1]["outcome"] == "returned" and wire["notices"][-1]["reason"] == "removed", wire["notices"]
    settled = next(w for w in wire["writes"] if w["path"].endswith("/settled"))["body"]
    assert settled["delivered"] is False and settled["reason"] == "removed" and settled["inferred"] == "batch.sent"
    for x in (a, b):
        assert items[x["id"]]["status"] == "pending" and not items[x["id"]]["sentSessions"], items[x["id"]]
    assert items[other["id"]]["status"] == "sent"
