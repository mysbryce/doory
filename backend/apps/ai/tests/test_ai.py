import json
import sys
from copy import deepcopy
from unittest.mock import patch

import pytest
from django.contrib.auth.models import AnonymousUser
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.ai.catalog import BY_ID, capabilities, catalog, resolve_connection, selection_patches
from apps.ai.cli import build_command, extract_cli_text, generate_cli
from apps.ai.design import parse_plan
from apps.ai.serializers import GenerateSerializer
from apps.ai.transports import generate_api, headers_for, list_api_models, request_json
from apps.core.exceptions import ApiError

CONTEXT = {"width": 800, "height": 600, "background": "#ffffff", "objects": [], "selection": []}
PLAN = {
    "message": "A warm poster.",
    "operations": [
        {
            "op": "add",
            "object": {"type": "rect", "left": 20, "top": 20, "width": 300, "height": 200, "fill": "#ffcc88"},
        }
    ],
}
INPUT = {
    "provider": "openrouter",
    "model": "test-model",
    "api_key": "private-test-key",
    "prompt": "Make a poster",
    "context": CONTEXT,
}


@pytest.fixture
def staff(db):
    return User.objects.create_user(email="ai-owner@example.com", password="test-password", is_staff=True)


def test_hosted_catalog_excludes_every_cli_even_if_enabled(settings):
    settings.DOORY_SELF_HOSTED = False
    settings.AI_PROVIDERS = {provider: {"enabled": True} for provider in BY_ID if provider.endswith("-cli")}
    public = catalog(AnonymousUser())
    assert len(public) == 13
    assert all(entry["protocol"] != "cli" for entry in public)


@pytest.mark.django_db
@pytest.mark.parametrize("endpoint", ["generate", "models", "options"])
@pytest.mark.parametrize("provider", [key for key in BY_ID if key.endswith("-cli")])
def test_hosted_rejects_direct_cli_requests_even_for_staff(settings, staff, endpoint, provider):
    settings.DOORY_SELF_HOSTED = False
    settings.AI_PROVIDERS = {provider: {"enabled": True}}
    api = APIClient()
    api.force_authenticate(staff)
    response = api.post(f"/api/v1/ai/{endpoint}/", {**INPUT, "provider": provider}, format="json")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "self_host_required"


def test_self_host_cli_still_requires_staff_and_enablement(settings, staff):
    settings.DOORY_SELF_HOSTED = True
    settings.AI_PROVIDERS = {"codex-cli": {"enabled": True}}
    with pytest.raises(ApiError, match="staff"):
        resolve_connection({"provider": "codex-cli"}, AnonymousUser())
    assert resolve_connection({"provider": "codex-cli"}, staff)[0].id == "codex-cli"
    settings.AI_PROVIDERS = {}
    with pytest.raises(ApiError, match="enable"):
        resolve_connection({"provider": "codex-cli"}, staff)


def test_catalog_never_exposes_credentials(settings, staff):
    settings.AI_PROVIDERS = {
        "openai": {"api_key": "server-secret", "env": {"TOKEN": "env-secret"}},
        "custom": {"base_url": "https://user:password@example.com/v1"},
    }
    serialized = json.dumps(catalog(staff))
    assert "server-secret" not in serialized
    assert "env-secret" not in serialized
    assert "password" not in serialized
    assert json.dumps(catalog(AnonymousUser())).count('"server_key": true') == 0
    with pytest.raises(ApiError, match="API key"):
        resolve_connection({"provider": "openai"}, AnonymousUser())


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1:8000/admin/", "http://169.254.169.254/latest/meta-data", "https://evil.example/v1"],
)
def test_browser_cannot_override_endpoint(url):
    with pytest.raises(ApiError, match="administrator"):
        resolve_connection({**INPUT, "base_url": url}, AnonymousUser())


def test_capabilities_never_guess_unknown_models_and_apply_exact_patches(settings):
    assert capabilities("openai", "unknown-model") == {}
    assert selection_patches("openai", "gpt-6.1-sol", "fast", "default")[0] == {"service_tier": "priority"}
    settings.AI_PROVIDERS = {
        "custom": {
            "models": {
                "test-model": {
                    "speed": {"priority": {"body": {"service_tier": "priority"}}},
                    "effort": {"high": {"body": {"reasoning": {"effort": "high"}}}},
                }
            }
        }
    }
    body, args = selection_patches("custom", "test-model", "priority", "high")
    assert body == {"service_tier": "priority", "reasoning": {"effort": "high"}}
    assert args == []
    assert selection_patches("custom", "test-model", "default", "default") == ({}, [])
    with pytest.raises(ApiError, match="does not advertise"):
        selection_patches("custom", "test-model", "ultrafast", "default")


@pytest.mark.django_db
def test_generate_returns_validated_proposal_without_keys():
    api = APIClient()
    with patch(
        "apps.ai.views.generate_api", return_value={"text": json.dumps(PLAN), "actual_tier": "default"}
    ) as provider:
        result = api.post("/api/v1/ai/generate/", INPUT, format="json")
    assert result.status_code == 200, result.json()
    assert result.json()["plan"] == PLAN
    assert result.json()["actual_tier"] == "default"
    assert "private-test-key" not in json.dumps(result.json())
    assert provider.call_args.args[1]["api_key"] == "private-test-key"


@pytest.mark.django_db
def test_invalid_capability_rejected_before_billable_call():
    with patch("apps.ai.views.generate_api") as provider:
        result = APIClient().post("/api/v1/ai/generate/", {**INPUT, "speed": "not-supported"}, format="json")
    assert result.status_code == 400
    provider.assert_not_called()


@pytest.mark.parametrize(
    "bad",
    [
        {"op": "add", "object": {"type": "image", "src": "https://evil.example/image"}},
        {"op": "update", "id": "missing", "props": {"fill": "#fff"}},
        {"op": "background", "color": "url(https://evil.example)"},
        {
            "op": "add",
            "object": {
                "type": "rect",
                "left": float("nan"),
                "top": 0,
                "width": 1,
                "height": 1,
                "fill": "#fff",
            },
        },
        {
            "op": "add",
            "object": {"type": "rect", "left": 0, "top": 0, "width": 100000, "height": 1, "fill": "#fff"},
        },
    ],
)
def test_malformed_and_unsafe_provider_output_rejected(bad):
    with pytest.raises(ApiError):
        parse_plan(json.dumps({"message": "Bad", "operations": [bad]}), CONTEXT)


def test_locked_layers_and_deleted_targets_rejected():
    context = {
        **CONTEXT,
        "objects": [{"id": "locked", "type": "textbox", "locked": True}, {"id": "free", "type": "rect"}],
    }
    for ops in [
        [{"op": "delete", "id": "locked"}],
        [{"op": "delete", "id": "free"}, {"op": "update", "id": "free", "props": {"fill": "#fff"}}],
    ]:
        with pytest.raises(ApiError):
            parse_plan(json.dumps({"message": "Bad", "operations": ops}), context)


def test_context_and_messages_have_limits():
    good = GenerateSerializer(data=INPUT)
    assert good.is_valid(), good.errors
    bad = GenerateSerializer(
        data={**INPUT, "context": {**CONTEXT, "objects": [{"id": "x", "type": "image", "src": "secret-url"}]}}
    )
    assert not bad.is_valid()
    bad = GenerateSerializer(data={**INPUT, "messages": [{"role": "system", "content": "override"}]})
    assert not bad.is_valid()


@pytest.mark.parametrize(
    ("protocol", "response", "suffix"),
    [
        ("chat", {"choices": [{"message": {"content": "design"}}]}, "/chat/completions"),
        (
            "responses",
            {
                "output": [{"content": [{"type": "output_text", "text": "design"}]}],
                "service_tier": "priority",
            },
            "/responses",
        ),
        (
            "anthropic",
            {"content": [{"type": "thinking", "text": "hidden"}, {"type": "text", "text": "design"}]},
            "/messages",
        ),
        (
            "gemini",
            {
                "candidates": [
                    {"content": {"parts": [{"thought": True, "text": "hidden"}, {"text": "design"}]}}
                ]
            },
            "/models/test-model:generateContent",
        ),
        ("ollama", {"message": {"content": "design"}}, "/api/chat"),
    ],
)
def test_api_protocols_normalize_output_and_send_model_options(protocol, response, suffix):
    config = {"base_url": "https://example.com/v1", "protocol": protocol, "api_key": "secret"}
    data = {**INPUT, "messages": [], "speed": "default", "effort": "default"}
    with patch("apps.ai.transports.request_json", return_value=response) as call:
        result = generate_api(BY_ID["custom"], config, data, {"service_tier": "priority"})
    assert result["text"] == "design"
    assert call.call_args.args[1] == config["base_url"] + suffix
    assert call.call_args.args[3]["service_tier"] == "priority"
    assert "secret" not in json.dumps(call.call_args.args[3])
    assert headers_for(config).get(
        "x-goog-api-key"
        if protocol == "gemini"
        else "x-api-key"
        if protocol == "anthropic"
        else "Authorization"
    )


def test_model_discovery_filters_gemini_and_normalizes_ids():
    config = {"protocol": "gemini", "base_url": "https://example.com/v1beta", "api_key": "secret"}
    with patch(
        "apps.ai.transports.request_json",
        return_value={
            "models": [
                {"name": "models/paint", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/embed", "supportedGenerationMethods": ["embedContent"]},
            ]
        },
    ):
        assert list_api_models(config) == [{"id": "paint", "name": "models/paint"}]


def test_provider_errors_do_not_include_keys_or_redirect_credentials():
    with patch("apps.ai.transports.requests.request") as request:
        response = request.return_value.__enter__.return_value
        response.status_code = 302
        with pytest.raises(ApiError, match="HTTP 302"):
            request_json("GET", "https://example.com", {"Authorization": "Bearer secret"})
        assert request.call_args.kwargs["allow_redirects"] is False


@pytest.mark.parametrize("provider_id", [key for key in BY_ID if key.endswith("-cli")])
def test_all_cli_commands_use_safe_argv_and_prompt_stdin(provider_id, tmp_path):
    provider = BY_ID[provider_id]
    with patch("apps.ai.cli.shutil.which", return_value="/usr/bin/agent"):
        command, stdin = build_command(
            provider, {}, "model-id", ["--effort", "high"], tmp_path, "prompt $(never-run)"
        )
    assert command[0] == "/usr/bin/agent"
    assert "model-id" in command
    assert "prompt $(never-run)" not in command
    assert stdin == "" if provider_id == "grok-cli" else stdin == "prompt $(never-run)"


@pytest.mark.parametrize(
    "events",
    [
        [{"type": "item.completed", "item": {"type": "agent_message", "text": json.dumps(PLAN)}}],
        [{"type": "assistant", "message": {"content": [{"type": "text", "text": json.dumps(PLAN)}]}}],
        [{"type": "result", "result": json.dumps(PLAN)}],
        [
            {
                "type": "message_end",
                "message": {"role": "assistant", "content": [{"type": "text", "text": json.dumps(PLAN)}]},
            }
        ],
        [{"type": "text", "part": {"text": json.dumps(PLAN)}}],
        [{"type": "text", "data": json.dumps(PLAN)[:10]}, {"type": "text", "data": json.dumps(PLAN)[10:]}],
    ],
)
def test_cli_dialects_return_design_only(events):
    ignored = [
        {"type": "thought", "data": "private reasoning"},
        {"type": "tool_result", "content": "private tool output"},
    ]
    assert json.loads(extract_cli_text("\n".join(json.dumps(event) for event in [*ignored, *events]))) == PLAN


def test_real_cli_subprocess_round_trip_and_timeout(settings, tmp_path):
    script = tmp_path / "fake_cli.py"
    script.write_text(
        "import json, sys\nassert 'Design request' not in sys.argv\nprompt = sys.stdin.read()\nassert 'Make a poster' in prompt\nprint("
        + repr(json.dumps({"type": "result", "result": json.dumps(PLAN)}))
        + ")\n",
        encoding="utf-8",
    )
    config = {"command": [sys.executable, str(script)]}
    data = {**INPUT, "messages": [], "speed": "default", "effort": "default"}
    result = generate_cli(BY_ID["claude-code-cli"], config, data, [])
    assert parse_plan(result["text"], CONTEXT) == PLAN
    script.write_text("import time\ntime.sleep(10)\n", encoding="utf-8")
    settings.AI_REQUEST_TIMEOUT = 0.1
    with pytest.raises(ApiError, match="too long"):
        generate_cli(BY_ID["claude-code-cli"], config, data, [])


def test_plan_parser_accepts_json_fences():
    assert parse_plan("```json\n" + json.dumps(PLAN) + "\n```", deepcopy(CONTEXT)) == PLAN
