"""Diple Docs — Hermes plugin (agent half).

Two hooks make the "open review" card (spec story 46, design §4):

* ``post_tool_call`` records every ``.md`` / ``.markdown`` file a successful
  ``write_file`` or ``patch`` call reports in ``files_modified``, keyed by
  (session, turn), in the plugin SQLite (the dashboard API and the agent may
  be different module instances or processes, ADR 0005);
* ``transform_llm_output`` appends ``::diple-docs{path="…"}`` for those
  files to the end of the answer, unless the user switched the card off in
  the desktop settings (mirrored into SQLite by the desktop half).

The host keeps only the FIRST non-empty ``transform_llm_output`` result
across plugins (``agent/turn_finalizer.py``), so when another plugin also
transforms the answer one of the two transformations is lost; see
docs/known-limitations.md.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from . import store as _store

logger = logging.getLogger(__name__)


def on_post_tool_call(tool_name: Any = None, result: Any = None, session_id: Any = "", turn_id: Any = "",
                      status: Any = None, **_: Any) -> None:
    try:
        paths = _store.written_review_paths(tool_name, result, status)
        if not paths:
            return None
        st = _store.store_for_current_home()
        for p in paths:
            st.record_turn_write(str(session_id or ""), str(turn_id or ""), p)
            # also list it under ⌘K "Recent documents": the card can be lost when another
            # plugin's transform_llm_output wins (first non-empty result only)
            st.touch_review(p)
    except Exception:  # never break a tool call because of the card
        logger.debug("diple-docs: post_tool_call failed", exc_info=True)
    return None


def on_transform_llm_output(response_text: Any = None, session_id: Any = "", turn_id: Any = "",
                            **_: Any) -> Optional[str]:
    try:
        if not isinstance(response_text, str) or not response_text:
            return None
        st = _store.store_for_current_home()
        paths = st.take_turn_writes(str(session_id or ""), str(turn_id or ""))
        if not paths or not st.get_settings().get("autoCard", True):
            return None
        return _store.append_cards(response_text, paths)
    except Exception:
        logger.debug("diple-docs: transform_llm_output failed", exc_info=True)
        return None


def register(ctx) -> None:
    ctx.register_hook("post_tool_call", on_post_tool_call)
    ctx.register_hook("transform_llm_output", on_transform_llm_output)
