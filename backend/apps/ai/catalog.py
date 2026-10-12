"""Provider protocols, not model-name guesses. Secrets never enter the public catalog."""

from copy import deepcopy
from dataclasses import dataclass
from urllib.parse import urlsplit

from django.conf import settings

from apps.core.exceptions import ApiError


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    protocol: str
    base_url: str = ""
    command: str = ""


# Independently implemented adapters matching DBX's AiProvider registry, plus OpenRouter.
PROVIDERS = [
    Provider("claude", "Anthropic / Claude", "anthropic", "https://api.anthropic.com/v1"),
    Provider("anthropic-compatible", "Anthropic-compatible", "anthropic"),
    Provider("openai", "OpenAI", "responses", "https://api.openai.com/v1"),
    Provider("gemini", "Google Gemini", "gemini", "https://generativelanguage.googleapis.com/v1beta"),
    Provider("deepseek", "DeepSeek", "chat", "https://api.deepseek.com/v1"),
    Provider("kimi", "Moonshot / Kimi", "chat", "https://api.moonshot.ai/v1"),
    Provider("qwen", "Alibaba / Qwen", "chat", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
    Provider("zhipu", "Zhipu / GLM", "chat", "https://open.bigmodel.cn/api/paas/v4"),
    Provider("minimax", "MiniMax", "anthropic", "https://api.minimax.io/anthropic/v1"),
    Provider("ollama", "Ollama", "ollama", "http://localhost:11434"),
    Provider("openrouter", "OpenRouter", "chat", "https://openrouter.ai/api/v1"),
    Provider("openai-compatible", "OpenAI-compatible", "chat"),
    Provider("custom", "Custom API router", "chat"),
    Provider("codex-cli", "Codex CLI", "cli", command="codex"),
    Provider("claude-code-cli", "Claude Code CLI", "cli", command="claude"),
    Provider("pi-agent-cli", "Pi Agent CLI", "cli", command="pi"),
    Provider("opencode-cli", "OpenCode CLI", "cli", command="opencode"),
    Provider("cursor-cli", "Cursor CLI", "cli", command="agent"),
    Provider("grok-cli", "Grok Build CLI", "cli", command="grok"),
    Provider("codebuddy-cli", "CodeBuddy CLI", "cli", command="codebuddy"),
    Provider("qoder-cli", "Qoder CLI", "cli", command="qodercli"),
]
BY_ID = {p.id: p for p in PROVIDERS}


def provider_config(provider_id):
    provider = BY_ID.get(provider_id)
    if provider is None:
        raise ApiError("invalid_provider", "Choose a supported AI provider.")
    config = deepcopy(settings.AI_PROVIDERS.get(provider_id, {}))
    config.setdefault("base_url", provider.base_url)
    config.setdefault("protocol", provider.protocol)
    return provider, config


def capabilities(provider_id, model):
    _, config = provider_config(provider_id)
    result = deepcopy(config.get("capabilities", {}))
    result.update(deepcopy(config.get("models", {}).get(model, {})))
    # Exact models verified against official Fast mode docs. Unknown models stay provider-default
    # until an administrator declares their capabilities; never infer support from a name prefix.
    if model in {"gpt-6.1-sol", "gpt-5.6-sol"}:
        if provider_id == "openai":
            result.setdefault(
                "speed",
                {
                    "standard": {"label": "Standard", "body": {"service_tier": "default"}},
                    "fast": {"label": "Fast", "body": {"service_tier": "priority"}},
                },
            )
        elif provider_id == "codex-cli":
            result.setdefault("speed", {"fast": {"label": "Fast", "args": ["-c", 'service_tier="fast"']}})
    # Routing preferences are not a service-tier promise. Native tiers remain opt-in per model.
    if provider_id == "openrouter":
        result.setdefault(
            "speed",
            {
                "latency": {"label": "Low latency", "body": {"provider": {"sort": "latency"}}},
                "throughput": {"label": "High throughput", "body": {"provider": {"sort": "throughput"}}},
            },
        )
    return result


def public_options(options):
    return [{"id": key, "label": value.get("label", key)} for key, value in options.items()]


def catalog(user):
    staff = bool(user.is_authenticated and user.is_staff)
    result = []
    for provider in PROVIDERS:
        _, config = provider_config(provider.id)
        local = provider.protocol == "cli" or provider.id == "ollama"
        enabled = bool(config.get("enabled", not local and bool(config["base_url"])))
        if provider.protocol == "cli" and not settings.DOORY_SELF_HOSTED:
            continue
        result.append(
            {
                "id": provider.id,
                "name": provider.name,
                "protocol": config["protocol"],
                "base_url": public_endpoint(config["base_url"]),
                "enabled": enabled and (staff or not local),
                "local": local,
                "server_key": staff and bool(config.get("api_key")),
                "models": list(config.get("models", {})),
            }
        )
    return result


def public_endpoint(url):
    parsed = urlsplit(url)
    # Misconfigured endpoints containing credentials must not become a public secret.
    return "" if parsed.username or parsed.password or parsed.query or parsed.fragment else url


def resolve_connection(data, user):
    provider, config = provider_config(data["provider"])
    staff = bool(user.is_authenticated and user.is_staff)
    local = provider.protocol == "cli" or provider.id == "ollama"
    if provider.protocol == "cli" and not settings.DOORY_SELF_HOSTED:
        raise ApiError("self_host_required", "CLI providers are available only on self-hosted Doory.", 403)
    if local and not staff:
        raise ApiError("staff_required", "Server-local providers require a staff account.", 403)
    if not config.get("enabled", not local and bool(config["base_url"])):
        raise ApiError("provider_disabled", "Ask the server administrator to enable this provider.", 403)
    if data.get("base_url") and data["base_url"].rstrip("/") != config["base_url"].rstrip("/"):
        # Never accept an arbitrary URL from a browser: no DNS rebinding or private-network proxy.
        raise ApiError(
            "endpoint_not_allowed", "This endpoint must be configured by the server administrator."
        )
    parsed = urlsplit(config["base_url"])
    if provider.protocol != "cli" and (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ApiError("invalid_endpoint", "The administrator must configure a valid API base URL.")
    key = data.get("api_key", "") or (config.get("api_key", "") if staff else "")
    if not key and not local and not config.get("key_optional", False):
        raise ApiError("api_key_required", "Enter your provider API key.")
    config["api_key"] = key
    config["base_url"] = config["base_url"].rstrip("/")
    return provider, config


def merge_patch(target, patch):
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            merge_patch(target[key], value)
        else:
            target[key] = deepcopy(value)
    return target


def selection_patches(provider_id, model, speed, effort):
    caps = capabilities(provider_id, model)
    body, args = {}, []
    for kind, selected in (("speed", speed), ("effort", effort)):
        if selected == "default":
            continue
        option = caps.get(kind, {}).get(selected)
        if option is None:
            raise ApiError("unsupported_option", f"This model does not advertise {kind} option '{selected}'.")
        merge_patch(body, option.get("body", {}))
        args.extend(option.get("args", []))
    return body, args
