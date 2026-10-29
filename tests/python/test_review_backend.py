"""Diple Docs backend skeleton: file reads, suffix rule, hand-off storage."""

from __future__ import annotations

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


def handoff(hid="h-0001", **extra):
    return {"v": 1, "handoffId": hid, "targetSessionId": "s1", "sendNow": False,
            "items": [{"origin": {"plugin": "diple-docs", "itemId": "i1", "revision": 1, "path": "/x.md", "line": 3},
                       "text": "原文", "comment": "意见"}], **extra}


def test_register_wires_the_card_hooks(hermes_home):
    pkg = load_plugin_package(PLUGIN_DIR, "hermes_plugins_diple_docs_test")
    hooks = {}

    class Ctx:
        def register_hook(self, name, fn):
            hooks[name] = fn

    assert pkg.register(Ctx()) is None
    assert set(hooks) == {"post_tool_call", "transform_llm_output"}


@pytest.mark.parametrize("name,ok", [("a.md", True), ("b.MARKDOWN", True), ("c.markdown", True),
                                     ("d.txt", False), ("e.mdx", False), ("md", False)])
def test_suffix_rule(api, name, ok):
    assert api.mod._store_mod.is_review_path(name) is ok


def test_read_markdown_and_stat(api, tmp_path):
    doc = tmp_path / "plan.markdown"
    doc.write_text("# 计划\n第一步\n", encoding="utf-8")
    r = api.get(f"{P}/file", params={"path": str(doc)})
    assert r.status_code == 200 and r.json()["text"] == "# 计划\n第一步\n"
    s = api.get(f"{P}/file/stat", params={"path": str(doc)}).json()
    assert s["mtime"] == r.json()["mtime"] and s["size"] == doc.stat().st_size
    assert api.get(f"{P}/reviews/recent").json()["reviews"][0]["path"] == str(doc)


@pytest.mark.parametrize("make,code", [
    (lambda d: d / "notes.txt", 415),
    (lambda d: d / "missing.md", 404),
    (lambda d: "relative/plan.md", 400),
])
def test_file_errors(api, tmp_path, make, code):
    target = make(tmp_path)
    if hasattr(target, "write_text") and target.suffix == ".txt":
        target.write_text("x")
    assert api.get(f"{P}/file", params={"path": str(target)}).status_code == code


def test_file_too_large(api, tmp_path):
    big = tmp_path / "big.md"
    big.write_bytes(b"x" * (5 * 1024 * 1024 + 1))
    assert api.get(f"{P}/file", params={"path": str(big)}).status_code == 413


def test_handoff_is_stored_broadcast_and_idempotent(api):
    r = api.post(f"{P}/handoffs", json=handoff())
    assert r.status_code == 200 and r.json()["receipt"] is None
    assert api.events == [("handoff", handoff())]
    api.post(f"{P}/handoffs", json=handoff(sendNow=True))  # same id: stored once, first payload kept
    assert api.get(f"{P}/handoffs/h-0001").json()["payload"]["sendNow"] is False
    assert [h["handoffId"] for h in api.get(f"{P}/handoffs").json()["handoffs"]] == ["h-0001"]


def test_receipt_settles_a_handoff_once(api):
    api.post(f"{P}/handoffs", json=handoff())
    first = {"v": 1, "handoffId": "h-0001", "accepted": ["i1"], "batchId": "b7k2m9"}
    api.post(f"{P}/handoffs/h-0001/receipt", json=first)
    api.post(f"{P}/handoffs/h-0001/receipt", json={"v": 1, "handoffId": "h-0001", "accepted": []})
    assert api.get(f"{P}/handoffs/h-0001").json()["receipt"] == first
    assert api.get(f"{P}/handoffs").json()["handoffs"] == []
    assert api.post(f"{P}/handoffs/h-0001/rebroadcast").json() == {"rebroadcast": False}


def test_rebroadcast_resends_until_receipt(api):
    api.post(f"{P}/handoffs", json=handoff())
    assert api.post(f"{P}/handoffs/h-0001/rebroadcast").json() == {"rebroadcast": True}
    assert len(api.events) == 2


@pytest.mark.parametrize("body", [handoff(v=2), handoff(handoffId="?"), handoff(items=[])])
def test_handoff_validation(api, body):
    assert api.post(f"{P}/handoffs", json=body).status_code == 400
    assert api.events == []


# -- XR-01: the real target is what gets checked (symlinks, devices, sensitive paths) ----------
def test_symlink_to_a_non_markdown_file_is_refused(api, tmp_path):
    secret = tmp_path / "sensitive.env"
    secret.write_text("SENTINEL_NOT_REAL_SECRET=example\n")
    alias = tmp_path / "alias.md"
    alias.symlink_to(secret)
    for route in ("/file", "/file/stat"):
        r = api.get(f"{P}{route}", params={"path": str(alias)})
        assert r.status_code == 415 and "SENTINEL" not in r.text, route
    st = api.get(f"{P}/review/state", params={"path": str(alias)}).json()
    assert st["exists"] is False and st["error"] == "unsupported-suffix"


def test_symlinked_directory_to_a_non_markdown_target_is_refused(api, tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    (real / "notes.txt").write_text("secret")
    (tmp_path / "linked.md").symlink_to(real / "notes.txt")
    link_dir = tmp_path / "dir-link"
    link_dir.symlink_to(real)
    (real / "ok.md").write_text("# fine\n")
    assert api.get(f"{P}/file", params={"path": str(tmp_path / "linked.md")}).status_code == 415
    # a symlinked folder holding a real Markdown file is fine
    r = api.get(f"{P}/file", params={"path": str(link_dir / "ok.md")})
    assert r.status_code == 200 and r.json()["text"] == "# fine\n"


def test_symlink_to_another_markdown_file_reads_it(api, tmp_path):
    (tmp_path / "real.md").write_text("# real\n")
    (tmp_path / "alias.markdown").symlink_to(tmp_path / "real.md")
    assert api.get(f"{P}/file", params={"path": str(tmp_path / "alias.markdown")}).json()["text"] == "# real\n"


def test_fifo_and_directory_named_md_are_refused_without_blocking(api, tmp_path):
    import os

    fifo = tmp_path / "pipe.md"
    os.mkfifo(fifo)
    folder = tmp_path / "folder.md"
    folder.mkdir()
    for p in (fifo, folder):
        for route in ("/file", "/file/stat"):
            r = api.get(f"{P}{route}", params={"path": str(p)})
            assert r.status_code == 415 and r.json()["detail"] == "not-regular", (p, route)


def test_symlink_to_a_device_is_refused(api, tmp_path):
    (tmp_path / "zero.md").symlink_to("/dev/zero")
    assert api.get(f"{P}/file", params={"path": str(tmp_path / "zero.md")}).status_code == 415


@pytest.mark.parametrize("rel", ["mcp-tokens/notes.md", "browser-profile/x.md", "skills/.hub/SKILL.md"])
def test_sensitive_hermes_paths_are_refused(api, hermes_home, rel):
    target = hermes_home / rel
    target.parent.mkdir(parents=True)
    target.write_text("# token-ish\n")
    r = api.get(f"{P}/file", params={"path": str(target)})
    assert r.status_code == 403 and r.json()["detail"] == "sensitive-path"


def test_markdown_alias_of_the_hermes_env_is_refused(api, hermes_home, tmp_path):
    env = hermes_home / ".env"
    env.write_text("SENTINEL_NOT_REAL_SECRET=1\n")
    alias = tmp_path / "env.md"
    alias.symlink_to(env)
    r = api.get(f"{P}/file", params={"path": str(alias)})
    assert r.status_code in (403, 415) and "SENTINEL" not in r.text


@pytest.mark.parametrize("rel", [".ssh/notes.md", ".aws/readme.md", ".gnupg/a.md", ".config/gh/hosts.md"])
def test_home_credential_dirs_are_refused(api, tmp_path, monkeypatch, rel):
    fake_home = tmp_path / "home"
    target = fake_home / rel
    target.parent.mkdir(parents=True)
    target.write_text("# x\n")
    monkeypatch.setenv("HOME", str(fake_home))
    r = api.get(f"{P}/file", params={"path": str(target)})
    assert r.status_code == 403 and r.json()["detail"] == "sensitive-path"


def test_read_is_capped_even_if_the_file_grows_after_the_size_check(api, tmp_path, monkeypatch):
    store = api.mod._store_mod
    doc = tmp_path / "grow.md"
    doc.write_text("x" * 10)
    monkeypatch.setattr(store, "MAX_FILE_BYTES", 16)
    assert api.get(f"{P}/file", params={"path": str(doc)}).status_code == 200
    doc.write_text("x" * 17)
    assert api.get(f"{P}/file", params={"path": str(doc)}).status_code == 413
    text, _st = store.read_review_file(str(doc), max_bytes=10_000)
    assert text == "x" * 17


def test_crlf_newlines_are_normalised_like_text_mode(api, tmp_path):
    doc = tmp_path / "crlf.md"
    doc.write_bytes(b"a\r\nb\rc\n")
    assert api.get(f"{P}/file", params={"path": str(doc)}).json()["text"] == "a\nb\nc\n"
