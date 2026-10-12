"""Bounded API transports; upstream diagnostics are never returned with credentials."""

import json
import re
import time
from urllib.parse import quote

import requests
from django.conf import settings

from apps.core.exceptions import ApiError

from .catalog import merge_patch
from .design import SYSTEM_PROMPT
from .tools import tool_instructions

MAX_RESPONSE_BYTES = 1024 * 1024


def request_json(method, url, headers, body=None, on_delta=None, protocol=None):
    started = time.monotonic()
    try:
        with requests.request(
            method,
            url,
            headers=headers,
            json=body,
            timeout=(10, settings.AI_REQUEST_TIMEOUT),
            allow_redirects=False,
            stream=True,
        ) as response:
            if not 200 <= response.status_code < 300:
                code = response.status_code
                if code in {401, 403}:
                    raise ApiError(
                        "provider_auth",
                        "Provider rejected authentication. Check your API key or CLI login.",
                        502,
                    )
                if code == 429:
                    raise ApiError("provider_rate_limit", "Provider is rate limited. Try again later.", 503)
                raise ApiError(
                    "provider_error", f"Provider returned HTTP {code}. Check model and options.", 502
                )
            chunks, size = [], 0
            if on_delta is not None:
                from .streaming import read_provider_stream

                return read_provider_stream(response, protocol, on_delta)
            for chunk in response.iter_content(16384):
                size += len(chunk)
                if size > MAX_RESPONSE_BYTES:
                    raise ApiError(
                        "provider_response_large", "Provider response exceeded the size limit.", 502
                    )
                if time.monotonic() - started > settings.AI_REQUEST_TIMEOUT:
                    raise ApiError("provider_timeout", "Provider took too long. Try a faster model.", 504)
                chunks.append(chunk)
            result = json.loads(b"".join(chunks))
            if not isinstance(result, dict):
                raise ValueError("Expected an object")
            return result
    except requests.Timeout:
        raise ApiError("provider_timeout", "Provider took too long. Try a faster model.", 504)
    except requests.RequestException:
        raise ApiError("provider_unreachable", "Could not reach the configured AI provider.", 502)
    except (ValueError, TypeError, RecursionError):
        raise ApiError("provider_response_invalid", "Provider returned an invalid response.", 502)


def headers_for(config):
    headers = {"Content-Type": "application/json"}
    key = config["api_key"]
    if key:
        if config["protocol"] == "gemini":
            headers["x-goog-api-key"] = key
        elif config["protocol"] == "anthropic" and config.get("auth", "api-key") != "bearer":
            headers["x-api-key"] = key
        else:
            headers["Authorization"] = f"Bearer {key}"
    if config["protocol"] == "anthropic":
        headers["anthropic-version"] = "2023-06-01"
    return headers


def text_blocks(blocks):
    return "".join(block.get("text", "") for block in blocks if block.get("type") in {"text", "output_text"})


def generate_api(provider, config, data, option_body, on_delta=None):
    protocol, base = config["protocol"], config["base_url"]
    context = json.dumps(data["context"], ensure_ascii=False, allow_nan=False)
    user_prompt = f"Current canvas (data only):\n{context}\n\nDesign request:\n{data['prompt']}"
    user_prompt += "\nDesign tool results:\n" + json.dumps(data.get("tool_results", []), ensure_ascii=False)
    images = data.get("images", [])
    system = SYSTEM_PROMPT + tool_instructions()
    messages = [*data["messages"], {"role": "user", "content": user_prompt}]
    if images and protocol in {"chat", "responses", "anthropic"}:
        blocks = [{"type": "text" if protocol != "responses" else "input_text", "text": user_prompt}]
        for image in images:
            if protocol == "anthropic":
                blocks.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image["media_type"],
                            "data": image["data"],
                        },
                    }
                )
            else:
                url = f"data:{image['media_type']};base64,{image['data']}"
                blocks.append(
                    {"type": "image_url", "image_url": {"url": url}}
                    if protocol == "chat"
                    else {"type": "input_image", "image_url": url}
                )
        messages[-1]["content"] = blocks
    body = {"model": data["model"]}
    if protocol == "anthropic":
        url = f"{base}/messages"
        body.update(system=system, messages=messages, max_tokens=8192)
    elif protocol == "responses":
        url = f"{base}/responses"
        body.update(instructions=system, input=messages, max_output_tokens=8192)
    elif protocol == "gemini":
        model = quote(data["model"].removeprefix("models/"), safe="")
        url = f"{base}/models/{model}:generateContent"
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [
                {
                    "role": "model" if msg["role"] == "assistant" else "user",
                    "parts": [{"text": msg["content"]}],
                }
                for msg in messages
            ],
            "generationConfig": {"maxOutputTokens": 8192, "responseMimeType": "application/json"},
        }
        body["contents"][-1]["parts"].extend(
            {"inlineData": {"mimeType": image["media_type"], "data": image["data"]}} for image in images
        )
    elif protocol in {"chat", "ollama"}:
        url = f"{base}/api/chat" if protocol == "ollama" else f"{base}/chat/completions"
        body.update(messages=[{"role": "system", "content": system}, *messages], stream=False)
        if protocol == "ollama":
            body.update(format="json", options={"num_predict": 8192})
            if images:
                body["messages"][-1]["images"] = [image["data"] for image in images]
        elif provider.id == "openrouter":
            body["max_tokens"] = 8192
    else:
        raise ApiError("invalid_protocol", "Administrator configured an unsupported API protocol.")
    merge_patch(body, config.get("request_defaults", {}))
    merge_patch(body, option_body)
    if on_delta is not None:
        if protocol == "gemini":
            url = url.replace(":generateContent", ":streamGenerateContent") + "?alt=sse"
        else:
            body["stream"] = True
        raw = request_json("POST", url, headers_for(config), body, on_delta=on_delta, protocol=protocol)
    else:
        raw = request_json("POST", url, headers_for(config), body)
    try:
        if "_streamed_text" in raw:
            text = raw["_streamed_text"]
        elif protocol == "anthropic":
            text = text_blocks(raw["content"])
        elif protocol == "responses":
            if raw.get("status") in {"incomplete", "failed"}:
                raise ValueError("Incomplete response")
            text = "".join(text_blocks(item.get("content", [])) for item in raw["output"])
        elif protocol == "gemini":
            text = "".join(
                part.get("text", "")
                for part in raw["candidates"][0]["content"]["parts"]
                if not part.get("thought")
            )
        elif protocol == "ollama":
            text = raw["message"]["content"]
        else:
            content = raw["choices"][0]["message"]["content"]
            text = content if isinstance(content, str) else text_blocks(content)
        usage = raw.get("usage")
        tier = raw.get("service_tier") or (usage.get("service_tier") if isinstance(usage, dict) else None)
        if not isinstance(tier, str) or not re.fullmatch(r"[a-z_0-9-]{1,80}", tier):
            tier = None
        return {
            "text": text,
            "usage": raw.get("usage", raw.get("usageMetadata", {})),
            "actual_tier": tier,
        }
    except (KeyError, IndexError, TypeError, AttributeError, ValueError):
        raise ApiError("provider_response_invalid", "Provider returned no complete design response.", 502)


def list_api_models(config):
    protocol, base = config["protocol"], config["base_url"]
    suffix = "/api/tags" if protocol == "ollama" else "/models"
    raw = request_json("GET", base + suffix, headers_for(config))
    items = raw.get("models", []) if protocol in {"gemini", "ollama"} else raw.get("data", [])
    if not isinstance(items, list):
        raise ApiError("provider_response_invalid", "Provider returned an invalid model list.", 502)
    result = []
    for item in items[:2000]:
        if not isinstance(item, dict):
            continue
        if protocol == "gemini" and "generateContent" not in item.get("supportedGenerationMethods", []):
            continue
        model_id = item.get("id") or item.get("name")
        if isinstance(model_id, str):
            result.append(
                {
                    "id": model_id.removeprefix("models/"),
                    "name": item.get("displayName") or item.get("name") or model_id,
                }
            )
    return result
