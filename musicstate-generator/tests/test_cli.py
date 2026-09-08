"""Unit tests for the CLI's versioned-output path logic (no audio, no build)."""
from __future__ import annotations

from pathlib import Path

from musicstate.cli import _choose_out, _next_versioned_path


def test_next_version_empty_dir_is_v1(tmp_path):
    assert _next_versioned_path(tmp_path, "levels") == tmp_path / "levels" / "v1.map.json"


def test_next_version_increments(tmp_path):
    d = tmp_path / "levels"
    d.mkdir()
    (d / "v1.map.json").write_text("{}")
    (d / "v2.map.json").write_text("{}")
    (d / "notes.txt").write_text("x")            # not a version file -> ignored
    assert _next_versioned_path(tmp_path, "levels") == d / "v3.map.json"


def test_next_version_uses_max_not_count(tmp_path):
    d = tmp_path / "levels"
    d.mkdir()
    (d / "v5.map.json").write_text("{}")         # a gap: next is 6, not 2
    (d / "vx.map.json").write_text("{}")         # malformed -> ignored
    assert _next_versioned_path(tmp_path, "levels") == d / "v6.map.json"


def test_choose_out_o_overrides_versioned(tmp_path):
    out, ignored = _choose_out("x.json", True, "levels", tmp_path)
    assert out == "x.json" and ignored is True


def test_choose_out_versioned_without_o(tmp_path):
    out, ignored = _choose_out(None, True, "levels", tmp_path)
    assert out == str(tmp_path / "levels" / "v1.map.json") and ignored is False


def test_choose_out_default_when_neither(tmp_path):
    out, ignored = _choose_out(None, False, "levels", tmp_path)
    assert out == "levels.map.json" and ignored is False
