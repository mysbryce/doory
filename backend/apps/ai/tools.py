"""Canonical tool contracts for the browser's isolated design draft."""

import json

from jsonschema import Draft202012Validator

from .design import invalid, validate_plan

IDS = {"type": "array", "items": {"type": "string", "maxLength": 200}, "maxItems": 60}


def tool(name, description, properties=None, required=None):
    return {
        "name": name,
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": properties or {},
            "required": required or [],
            "additionalProperties": False,
        },
    }


TOOL_DEFINITIONS = [
    tool(
        "get_canvas",
        "Read draft layers, selection, dimensions, styles, animations and transition.",
    ),
    tool(
        "inspect_layout",
        "Measure Fabric bounds, gaps, alignment, margins, clipping and textbox overflow. "
        "Overlaps are observations, not automatically errors.",
        {"ids": IDS, "tolerance": {"type": "number", "minimum": 0, "maximum": 100}},
    ),
    tool(
        "inspect_styles",
        "Inspect typography, palette, stroke, effects and sampled raster contrast. "
        "Report inconsistent fonts/sizes and contrast needing review.",
        {"ids": IDS},
    ),
    tool(
        "get_motion_catalog",
        "List all registered animation/transition presets, directions, defaults and text units. "
        "Use exact catalog ids.",
    ),
    tool(
        "inspect_motion",
        "Inspect animation spans, delays, duration, looping, overlaps and transition. "
        "Get the timeline and issue list.",
    ),
    tool(
        "capture_canvas",
        "See the rendered draft using the export pipeline. Image is attached to the next model turn.",
        {"time_ms": {"type": "number", "minimum": 0, "maximum": 120000}},
    ),
    tool(
        "capture_motion",
        "See a labeled filmstrip of animation/transition frames, with timestamps and progress. "
        "Always use after motion edits.",
        {
            "mode": {"enum": ["animation", "transition"]},
            "times_ms": {
                "type": "array",
                "items": {"type": "number", "minimum": 0, "maximum": 120000},
                "minItems": 2,
                "maxItems": 6,
            },
        },
    ),
    tool(
        "apply_design",
        "Apply graphics operations to the isolated draft. Never changes the live canvas. "
        "Returns fresh ids for subsequent styling/motion edits.",
        {"operations": {"type": "array", "items": {"type": "object"}, "minItems": 1, "maxItems": 100}},
        ["operations"],
    ),
]
BY_NAME = {definition["name"]: definition for definition in TOOL_DEFINITIONS}


def tool_instructions():
    return """\nYou are a design agent with these tools, executed on an isolated browser draft.
Request tools with ONLY JSON {"message":"brief progress",
"tool_calls":[{"id":"unique-call-id","name":"tool name","arguments":{...}}]}.
Use up to 8 calls per turn. Results arrive in the next user message. Inspect canvas before editing.
Measure gaps/alignment and inspect styles. Look at capture_canvas after edits.
Never claim you saw an image unless attached or read through read_design_snapshot.
Use get_motion_catalog before setting animations or
transitions. Inspect motion and capture_motion after motion edits. Revise issues, then return final JSON
{"message":"what changed and verified","operations":[]} when the draft is ready. You can also return final
operations directly; the host will render and audit them before asking you to verify. Do not repeat already
applied draft edits. If a visual tool fails, say so.
Tools cannot execute code, access files or mutate live canvas.
Tool definitions:\n""" + json.dumps(TOOL_DEFINITIONS)


def parse_agent_response(text, context):
    # Reuse the bounded/fenced JSON parser for terminal plans; tool envelopes have their own strict contract.
    from .design import parse_plan

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        raw = json.loads(cleaned)
    except (ValueError, TypeError, RecursionError):
        invalid()
    if not isinstance(raw, dict) or "tool_calls" not in raw:
        return {"plan": parse_plan(text, context), "tool_calls": []}
    if (
        set(raw) != {"message", "tool_calls"}
        or not isinstance(raw["message"], str)
        or len(raw["message"]) > 2000
    ):
        invalid()
    calls = raw["tool_calls"]
    if not isinstance(calls, list) or not 1 <= len(calls) <= 8:
        invalid()
    seen = set()
    for call in calls:
        if not isinstance(call, dict) or set(call) != {"id", "name", "arguments"}:
            invalid()
        name = call["name"]
        if not isinstance(name, str) or name not in BY_NAME:
            invalid()
        if not isinstance(call["id"], str) or not 1 <= len(call["id"]) <= 80 or call["id"] in seen:
            invalid()
        seen.add(call["id"])
        if not Draft202012Validator(BY_NAME[name]["input_schema"]).is_valid(call["arguments"]):
            invalid()
        if name == "apply_design":
            validate_plan({"message": raw["message"], "operations": call["arguments"]["operations"]}, context)
    return {"plan": None, "tool_calls": calls, "message": raw["message"]}
