import base64
import json
from io import BytesIO, StringIO
from unittest.mock import patch

import pytest
from PIL import Image

from apps.ai.catalog import BY_ID
from apps.ai.cli import attach_cli_images, build_command
from apps.ai.design import parse_plan
from apps.ai.serializers import GenerateSerializer
from apps.ai.snapshot_mcp import serve
from apps.ai.tools import TOOL_DEFINITIONS, parse_agent_response
from apps.ai.transports import generate_api
from apps.core.exceptions import ApiError

CONTEXT = {
    "width": 800,
    "height": 600,
    "background": "#fff",
    "objects": [{"id": "text", "type": "textbox"}],
    "selection": [],
}


def preview_image():
    output = BytesIO()
    Image.new("RGB", (10, 10), "orange").save(output, format="PNG")
    return {"label": "Draft", "media_type": "image/png", "data": base64.b64encode(output.getvalue()).decode()}


def test_tool_registry_covers_visual_layout_styling_and_all_motion_boundaries():
    assert {definition["name"] for definition in TOOL_DEFINITIONS} == {
        "get_canvas",
        "inspect_layout",
        "inspect_styles",
        "get_motion_catalog",
        "inspect_motion",
        "capture_canvas",
        "capture_motion",
        "apply_design",
    }


@pytest.mark.parametrize(
    "call",
    [
        {"id": "x", "name": "run_shell", "arguments": {"command": "anything"}},
        {"id": "x", "name": "capture_canvas", "arguments": {"time_ms": -1}},
        {"id": "x", "name": "inspect_layout", "arguments": {"ids": "all"}},
        {"id": "x", "name": "apply_design", "arguments": {"operations": [{"op": "delete", "id": "missing"}]}},
    ],
)
def test_invalid_tool_calls_are_rejected(call):
    with pytest.raises(ApiError):
        parse_agent_response(json.dumps({"message": "Tool", "tool_calls": [call]}), CONTEXT)


def test_motion_effects_gradient_and_type_decorations_are_bounded():
    operations = [
        {
            "op": "animation",
            "id": "text",
            "slot": "enter",
            "value": {"preset": "fade", "durationMs": 600, "delayMs": 0, "easing": "ease-out"},
        },
        {"op": "transition", "value": {"preset": "fade", "durationMs": 700, "easing": "ease-in-out"}},
        {
            "op": "effects",
            "id": "text",
            "value": {"shadow": {"color": "#0008", "blur": 20, "offsetX": 0, "offsetY": 8}},
        },
        {
            "op": "background_style",
            "value": {
                "type": "gradient",
                "kind": "linear",
                "stops": [{"offset": 0, "color": "#fff"}, {"offset": 1, "color": "#ff0"}],
            },
        },
        {"op": "update", "id": "text", "props": {"underline": True, "charSpacing": 100}},
    ]
    assert (
        parse_plan(json.dumps({"message": "Motion", "operations": operations}), CONTEXT)["operations"]
        == operations
    )
    operations[0]["value"]["durationMs"] = 100000
    with pytest.raises(ApiError):
        parse_plan(json.dumps({"message": "Bad", "operations": operations}), CONTEXT)


def test_preview_images_are_decoded_and_verified_before_a_provider_call():
    data = {
        "provider": "openai",
        "model": "vision",
        "api_key": "key",
        "prompt": "poster",
        "context": CONTEXT,
        "images": [preview_image()],
    }
    serializer = GenerateSerializer(data=data)
    assert serializer.is_valid(), serializer.errors
    data["images"][0]["data"] = "not-image-data"
    assert not GenerateSerializer(data=data).is_valid()


@pytest.mark.parametrize("protocol", ["chat", "responses", "anthropic", "gemini", "ollama"])
def test_every_api_protocol_receives_native_visual_content(protocol):
    image = preview_image()
    config = {"base_url": "https://example.com/v1", "protocol": protocol, "api_key": "key"}
    data = {"model": "vision", "prompt": "poster", "context": CONTEXT, "messages": [], "images": [image]}
    responses = {
        "chat": {"choices": [{"message": {"content": "{}"}}]},
        "responses": {"output": [{"content": [{"type": "output_text", "text": "{}"}]}]},
        "anthropic": {"content": [{"type": "text", "text": "{}"}]},
        "gemini": {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]},
        "ollama": {"message": {"content": "{}"}},
    }
    with patch("apps.ai.transports.request_json", return_value=responses[protocol]) as request:
        generate_api(BY_ID["custom"], config, data, {})
    body = request.call_args.args[3]
    assert image["data"] in json.dumps(body)
    assert "get_motion_catalog" in json.dumps(body)
    assert "capture_canvas" in json.dumps(body)


@pytest.mark.parametrize("provider_id", [key for key in BY_ID if key.endswith("-cli")])
def test_all_cli_providers_have_a_visual_transport(provider_id, tmp_path):
    with patch("apps.ai.cli.shutil.which", return_value="/usr/bin/agent"):
        command, stdin = build_command(BY_ID[provider_id], {}, "vision", [], tmp_path, "Inspect draft")
    image = preview_image()
    command, stdin, environment = attach_cli_images(BY_ID[provider_id], command, stdin, tmp_path, [image])
    assert (tmp_path / "preview-0.png").exists()
    if provider_id in {"claude-code-cli", "codebuddy-cli", "qoder-cli"}:
        assert image["data"] in stdin
        assert command[command.index("--input-format") + 1] == "stream-json"
    elif provider_id == "codex-cli":
        assert "--image" in command
    elif provider_id == "opencode-cli":
        assert "--file" in command
    elif provider_id == "pi-agent-cli":
        assert any(argument.startswith("@") for argument in command)
    else:
        assert json.loads((tmp_path / "snapshots.json").read_text())[0] == image
        assert "read_design_snapshot" in (
            stdin if provider_id == "cursor-cli" else (tmp_path / "prompt.txt").read_text()
        )
        if provider_id == "grok-cli":
            assert environment["GROK_HOME"].endswith(".grok")


def test_snapshot_mcp_serves_images_and_exposes_no_filesystem_or_mutation_tools():
    requests = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "read_design_snapshot", "arguments": {}},
        },
    ]
    output = StringIO()
    serve([preview_image()], StringIO("\n".join(json.dumps(request) for request in requests)), output)
    responses = [json.loads(line) for line in output.getvalue().splitlines()]
    assert responses[0]["result"]["protocolVersion"] == "2025-03-26"
    assert [tool["name"] for tool in responses[1]["result"]["tools"]] == ["read_design_snapshot"]
    assert responses[2]["result"]["content"][1]["type"] == "image"
