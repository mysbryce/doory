"""Normalize real provider SSE/NDJSON into text deltas; never synthesize a token stream."""

import json
import time

from django.conf import settings

from apps.core.exceptions import ApiError


def read_provider_stream(response, protocol, on_delta):
    text, tier, event_data = [], None, []
    size = 0
    deadline = time.monotonic() + settings.AI_REQUEST_TIMEOUT

    def consume(payload):
        nonlocal tier
        if payload == "[DONE]":
            return
        event = json.loads(payload)
        if (
            not isinstance(event, dict)
            or event.get("error")
            or event.get("type") in {"error", "response.failed"}
        ):
            raise ApiError("provider_stream_error", "Provider could not complete the streamed response.", 502)
        delta = ""
        if protocol == "responses":
            if event.get("type") == "response.output_text.delta":
                delta = event.get("delta", "")
            if event.get("type") == "response.completed":
                tier = event.get("response", {}).get("service_tier")
            if event.get("type") == "response.incomplete":
                raise ApiError(
                    "provider_response_invalid", "Provider stopped before completing the design.", 502
                )
        elif protocol == "anthropic":
            if (
                event.get("type") == "content_block_delta"
                and event.get("delta", {}).get("type") == "text_delta"
            ):
                delta = event["delta"].get("text", "")
            tier = event.get("usage", {}).get("service_tier", tier)
        elif protocol == "gemini":
            candidates = event.get("candidates", [])
            if candidates:
                delta = "".join(
                    part.get("text", "")
                    for part in candidates[0].get("content", {}).get("parts", [])
                    if not part.get("thought")
                )
        elif protocol == "ollama":
            delta = event.get("message", {}).get("content", "")
        else:
            choices = event.get("choices", [])
            if choices:
                delta = choices[0].get("delta", {}).get("content", "") or ""
            tier = event.get("service_tier", tier)
        if isinstance(delta, str) and delta:
            text.append(delta)
            on_delta(delta)

    for raw in response.iter_lines(chunk_size=512):
        size += len(raw)
        if size > 8 * 1024 * 1024:
            raise ApiError("provider_response_large", "Provider stream exceeded the size limit.", 502)
        if time.monotonic() > deadline:
            raise ApiError("provider_timeout", "Provider took too long. Try a faster model.", 504)
        line = raw.decode("utf-8")
        if protocol == "ollama":
            if line:
                consume(line)
        elif line.startswith("data:"):
            event_data.append(line[5:].lstrip())
        elif not line and event_data:
            consume("\n".join(event_data))
            event_data.clear()
    if event_data:
        consume("\n".join(event_data))
    if not text:
        raise ApiError("provider_response_invalid", "Provider streamed no design response.", 502)
    return {"_streamed_text": "".join(text), "service_tier": tier}
