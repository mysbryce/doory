import asyncio
import hashlib
import json
import queue
import threading

from django.conf import settings
from django.core.cache import cache
from django.db import connections
from django.http import StreamingHttpResponse
from django.views.decorators.cache import never_cache
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import api_view, parser_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from apps.core.exceptions import ApiError
from apps.core.parsers import BoundedJSONParser

from .catalog import capabilities, catalog, public_options, resolve_connection, selection_patches
from .cli import generate_cli
from .serializers import GenerateSerializer, OptionsSerializer
from .tools import TOOL_DEFINITIONS, parse_agent_response
from .transports import generate_api, list_api_models


class AIThrottle(SimpleRateThrottle):
    scope = "ai"
    rate = "30/min"

    def get_cache_key(self, request, view):
        ident = str(request.user.pk) if request.user.is_authenticated else self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class AIParser(BoundedJSONParser):
    def limit(self):
        return 2 * 1024 * 1024


@extend_schema(responses={200: dict}, tags=["ai"])
@api_view(["GET"])
@permission_classes([AllowAny])
@never_cache
def providers(request):
    return Response({"self_hosted": settings.DOORY_SELF_HOSTED, "providers": catalog(request.user)})


@extend_schema(request=OptionsSerializer, responses={200: dict}, tags=["ai"])
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AIThrottle])
@never_cache
def models(request):
    serializer = OptionsSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    provider, config = resolve_connection(data, request.user)
    # CLI catalogs are administrator-configured; do not launch an agent to discover models.
    model_list = [{"id": model, "name": model} for model in config.get("models", {})]
    if provider.protocol != "cli":
        model_list = list_api_models(config)
    caps = capabilities(provider.id, data["model"])
    return Response(
        {
            "models": model_list,
            "speed": public_options(caps.get("speed", {})),
            "effort": public_options(caps.get("effort", {})),
        }
    )


@extend_schema(request=OptionsSerializer, responses={200: dict}, tags=["ai"])
@api_view(["POST"])
@permission_classes([AllowAny])
@never_cache
def options(request):
    serializer = OptionsSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    # Even capability requests obey the self-host/permission/endpoint boundary.
    provider, _ = resolve_connection(data, request.user)
    caps = capabilities(provider.id, data["model"])
    return Response(
        {"speed": public_options(caps.get("speed", {})), "effort": public_options(caps.get("effort", {}))}
    )


@extend_schema(request=GenerateSerializer, responses={200: dict}, tags=["ai"])
@api_view(["POST"])
@parser_classes([AIParser])
@permission_classes([AllowAny])
@throttle_classes([AIThrottle])
@never_cache
def generate(request):
    serializer = GenerateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    provider, config = resolve_connection(data, request.user)
    body, args = selection_patches(provider.id, data["model"], data["speed"], data["effort"])
    ident = str(request.user.pk) if request.user.is_authenticated else AIThrottle().get_ident(request)
    lock = "doory-ai-active:" + hashlib.sha256(ident.encode()).hexdigest()
    if not cache.add(lock, True, timeout=settings.AI_REQUEST_TIMEOUT + 30):
        raise ApiError("ai_busy", "An AI request is already running. Wait for it to finish.", 429)
    try:
        if provider.protocol == "cli":
            raw = generate_cli(provider, config, data, args)
        else:
            raw = generate_api(provider, config, data, body)
        result = parse_agent_response(raw["text"], data["context"])
        # A caller-supplied key can never leak via raw provider diagnostics/metadata.
        return Response(
            {**result, "actual_tier": raw["actual_tier"], "provider": provider.id, "model": data["model"]}
        )
    finally:
        cache.delete(lock)


@extend_schema(responses={200: dict}, tags=["ai"])
@api_view(["GET"])
@permission_classes([AllowAny])
@never_cache
def tools(request):
    return Response({"tools": TOOL_DEFINITIONS})


@extend_schema(request=GenerateSerializer, responses={200: dict}, tags=["ai"])
@api_view(["POST"])
@parser_classes([AIParser])
@permission_classes([AllowAny])
@throttle_classes([AIThrottle])
@never_cache
def stream(request):
    serializer = GenerateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    provider, config = resolve_connection(data, request.user)
    body, args = selection_patches(provider.id, data["model"], data["speed"], data["effort"])
    ident = str(request.user.pk) if request.user.is_authenticated else AIThrottle().get_ident(request)
    lock = "doory-ai-active:" + hashlib.sha256(ident.encode()).hexdigest()
    if not cache.add(lock, True, timeout=settings.AI_REQUEST_TIMEOUT + 30):
        raise ApiError("ai_busy", "An AI request is already running. Wait for it to finish.", 429)
    events = queue.Queue(maxsize=128)
    cancelled = threading.Event()

    def publish(event):
        if cancelled.is_set():
            raise ApiError("cancelled", "Design generation cancelled.", 499)
        try:
            events.put(event, timeout=2)
        except queue.Full:
            raise ApiError("cancelled", "Streaming client stopped receiving.", 499)

    def run():
        try:

            def delta(text):
                publish({"type": "delta", "text": text})

            if provider.id == "codex-cli":
                from .codex_stream import generate_codex_stream

                raw = generate_codex_stream(provider, config, data, args, delta, cancelled)
            elif provider.protocol == "cli":
                raw = generate_cli(provider, config, data, args, on_delta=delta, cancelled=cancelled)
            else:
                raw = generate_api(provider, config, data, body, on_delta=delta)
            result = parse_agent_response(raw["text"], data["context"])
            publish(
                {
                    "type": "result",
                    "result": {
                        **result,
                        "actual_tier": raw["actual_tier"],
                        "provider": provider.id,
                        "model": data["model"],
                    },
                }
            )
        except ApiError as error:
            if not cancelled.is_set():
                publish({"type": "error", "message": str(error.detail), "code": error.get_codes()})
        except Exception:
            if not cancelled.is_set():
                publish(
                    {
                        "type": "error",
                        "message": "Provider stream failed. Check CLI version, model and connection.",
                        "code": "provider_stream_error",
                    }
                )
        finally:
            cache.delete(lock)
            connections.close_all()

    def next_event():
        try:
            return events.get(timeout=1)
        except queue.Empty:
            return {"type": "ping"}

    def encode(event):
        return (json.dumps(event, ensure_ascii=False) + "\n").encode()

    def sync_body():
        try:
            yield encode({"type": "start"})
            while True:
                event = next_event()
                yield encode(event)
                if event["type"] in {"result", "error"}:
                    break
        finally:
            cancelled.set()

    async def async_body():
        try:
            yield encode({"type": "start"})
            while True:
                event = await asyncio.to_thread(next_event)
                yield encode(event)
                if event["type"] in {"result", "error"}:
                    break
        finally:
            cancelled.set()

    threading.Thread(target=run, daemon=True).start()
    response = StreamingHttpResponse(
        async_body() if hasattr(request._request, "scope") else sync_body(),
        content_type="application/x-ndjson",
    )
    response["X-Accel-Buffering"] = "no"
    return response
