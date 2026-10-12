"""Strict motion edits, matching the editor's public document contract."""

import math
import re

from .design import invalid


def validate_motion(value, transition=False):
    if value is None:
        return
    allowed = {"preset", "durationMs", "easing", "direction"}
    if not transition:
        allowed |= {"delayMs", "by", "loop", "intensity"}
    if not isinstance(value, dict) or set(value) - allowed:
        invalid()
    if not isinstance(value.get("preset"), str) or not re.fullmatch(r"[a-z0-9-]{1,40}", value["preset"]):
        invalid()
    for key, bounds in {
        "durationMs": (200, 3000) if transition else (100, 10000),
        "delayMs": (0, 60000),
        "intensity": (0, 1),
    }.items():
        number = value.get(key, 0 if key == "delayMs" else 0.5 if key == "intensity" else None)
        if (
            isinstance(number, bool)
            or not isinstance(number, (float, int))
            or not math.isfinite(number)
            or not bounds[0] <= number <= bounds[1]
        ):
            invalid()
    for key, choices in {
        "easing": {"linear", "ease-in", "ease-out", "ease-in-out", "spring", "bounce"},
        "direction": {"left", "right", "up", "down", "in", "out"},
        "by": {"object", "line", "word", "letter"},
    }.items():
        if key in value and (not isinstance(value[key], str) or value[key] not in choices):
            invalid()
    if "loop" in value and not isinstance(value["loop"], bool):
        invalid()
