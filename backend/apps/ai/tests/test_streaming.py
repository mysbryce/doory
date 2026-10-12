import json
import sys
import threading
from io import StringIO
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.ai.catalog import BY_ID
from apps.ai.cli import generate_cli
from apps.ai.codex_stream import generate_codex_stream
from apps.ai.streaming import read_provider_stream


@pytest.mark.parametrize(
    ("protocol", "payloads"),
    [
        (
            "chat",
            [{"choices": [{"delta": {"content": "hello "}}]}, {"choices": [{"delta": {"content": "world"}}]}],
        ),
        (
            "responses",
            [
                {"type": "response.output_text.delta", "delta": "hello "},
                {"type": "response.output_text.delta", "delta": "world"},
            ],
        ),
        (
            "anthropic",
            [
                {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "hello "}},
                {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "world"}},
            ],
        ),
        (
            "gemini",
            [
                {"candidates": [{"content": {"parts": [{"text": "hello "}]}}]},
                {"candidates": [{"content": {"parts": [{"text": "world"}]}}]},
            ],
        ),
        ("ollama", [{"message": {"content": "hello "}}, {"message": {"content": "world"}}]),
    ],
)
def test_all_api_protocols_publish_real_deltas_before_the_stream_finishes(protocol, payloads):
    class Response:
        def iter_lines(self, **kwargs):
            for payload in payloads:
                line = json.dumps(payload).encode()
                yield line if protocol == "ollama" else b"data: " + line
                if protocol != "ollama":
                    yield b""

    observed = []
    result = read_provider_stream(Response(), protocol, observed.append)
    assert observed == ["hello ", "world"]
    assert result["_streamed_text"] == "hello world"


@pytest.mark.django_db(transaction=True)
def test_ndjson_endpoint_streams_then_validates_the_final_design():
    plan = {"message": "**Ready**", "operations": [{"op": "background", "color": "#ffaa00"}]}

    def provider(*args, on_delta=None, **kwargs):
        text = json.dumps(plan)
        on_delta(text[:10])
        on_delta(text[10:])
        return {"text": text, "actual_tier": "default"}

    data = {
        "provider": "openai",
        "api_key": "test-key",
        "model": "test",
        "prompt": "Poster",
        "context": {"width": 800, "height": 600, "background": "#fff", "objects": [], "selection": []},
    }
    with patch("apps.ai.views.generate_api", side_effect=provider):
        response = APIClient().post(
            "/api/v1/ai/stream/", data, format="json", HTTP_ACCEPT="application/x-ndjson, application/json"
        )
        events = [json.loads(line) for line in response.streaming_content]
    assert response.status_code == 200
    assert response["X-Accel-Buffering"] == "no"
    assert [event["type"] for event in events] == ["start", "delta", "delta", "result"]
    assert events[-1]["result"]["plan"] == plan


@pytest.mark.django_db
def test_hosted_stream_endpoint_rejects_cli_before_starting_a_worker(settings):
    settings.DOORY_SELF_HOSTED = False
    data = {
        "provider": "codex-cli",
        "model": "default",
        "prompt": "Poster",
        "context": {"width": 800, "height": 600, "background": "#fff", "objects": [], "selection": []},
    }
    api = APIClient()
    api.force_authenticate(User.objects.create_user(email="stream-owner@example.com", is_staff=True))
    response = api.post("/api/v1/ai/stream/", data, format="json")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "self_host_required"


def test_codex_app_server_sends_native_images_and_emits_deltas_before_completion():
    class Pipe(StringIO):
        def close(self):
            pass

    events = [
        {"id": 1, "result": {}},
        {"id": 2, "result": {"thread": {"id": "test-thread"}}},
        {"id": 3, "result": {}},
        {"method": "item/agentMessage/delta", "params": {"delta": "hello "}},
        {"method": "item/agentMessage/delta", "params": {"delta": "world"}},
        {"method": "item/completed", "params": {"item": {"type": "agentMessage", "text": "hello world"}}},
        {"method": "turn/completed", "params": {"turn": {"status": "completed"}}},
    ]
    process = type(
        "Process",
        (),
        {
            "stdin": Pipe(),
            "stdout": Pipe("\n".join(json.dumps(event) for event in events)),
            "poll": lambda self: 0,
        },
    )()
    observed = []
    data = {
        "model": "default",
        "prompt": "Poster",
        "context": {},
        "messages": [],
        "images": [{"media_type": "image/png", "data": "test-preview"}],
    }
    with (
        patch("apps.ai.codex_stream.command_prefix", return_value=["codex"]),
        patch("apps.ai.codex_stream.subprocess.Popen", return_value=process),
    ):
        result = generate_codex_stream(BY_ID["codex-cli"], {}, data, [], observed.append, threading.Event())
    requests = [json.loads(line) for line in process.stdin.getvalue().splitlines()]
    turn = next(request["params"] for request in requests if request["method"] == "turn/start")
    assert observed == ["hello ", "world"]
    assert result["text"] == "hello world"
    assert turn["input"][-1] == {"type": "image", "url": "data:image/png;base64,test-preview"}
    assert turn["sandboxPolicy"] == {"type": "readOnly", "networkAccess": False}
    assert turn["approvalPolicy"] == "never"


@pytest.mark.parametrize(
    ("provider_id", "event"),
    [
        (
            "claude-code-cli",
            {"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"text": "hello"}}},
        ),
        (
            "codebuddy-cli",
            {"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"text": "hello"}}},
        ),
        ("qoder-cli", {"type": "assistant", "message": {"content": [{"type": "text", "text": "hello"}]}}),
        (
            "cursor-cli",
            {
                "type": "assistant",
                "timestamp_ms": 100,
                "message": {"content": [{"type": "text", "text": "hello"}]},
            },
        ),
        ("opencode-cli", {"type": "text", "part": {"text": "hello"}}),
        ("grok-cli", {"type": "text", "data": "hello"}),
        (
            "pi-agent-cli",
            {"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": "hello"}},
        ),
    ],
)
def test_each_cli_streams_native_events_while_the_process_is_still_running(provider_id, event, tmp_path):
    marker = tmp_path / "finished"
    script = tmp_path / "streaming_cli.py"
    script.write_text(
        "import time\nfrom pathlib import Path\nprint("
        + repr(json.dumps(event))
        + ", flush=True)\n"
        + "time.sleep(0.4)\nPath("
        + repr(str(marker))
        + ").touch()\n"
        + "print("
        + repr(json.dumps({"type": "result", "result": "hello"}))
        + ", flush=True)\n",
        encoding="utf-8",
    )
    observed = []
    data = {"model": "default", "prompt": "Poster", "context": {}, "messages": []}

    def delta(text):
        assert not marker.exists(), "Delta must arrive before the CLI finishes"
        observed.append(text)

    result = generate_cli(
        BY_ID[provider_id],
        {"command": [sys.executable, str(script)]},
        data,
        [],
        on_delta=delta,
        cancelled=threading.Event(),
    )
    assert observed == ["hello"]
    assert result["text"] == "hello"
