import base64
import json
import math
from io import BytesIO

from PIL import Image
from rest_framework import serializers

from .catalog import BY_ID
from .design import FIELDS


class ConnectionSerializer(serializers.Serializer):
    provider = serializers.ChoiceField(choices=list(BY_ID))
    api_key = serializers.CharField(max_length=4096, required=False, allow_blank=True, trim_whitespace=True)
    base_url = serializers.CharField(max_length=2048, required=False, allow_blank=True)


class OptionsSerializer(ConnectionSerializer):
    model = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class GenerateSerializer(OptionsSerializer):
    model = serializers.CharField(max_length=200)
    prompt = serializers.CharField(max_length=8000)
    speed = serializers.CharField(max_length=80, default="default")
    effort = serializers.CharField(max_length=80, default="default")
    context = serializers.JSONField()
    messages = serializers.ListField(child=serializers.DictField(), max_length=20, default=list)
    tool_results = serializers.ListField(child=serializers.DictField(), max_length=8, default=list)
    images = serializers.ListField(child=serializers.DictField(), max_length=3, default=list)

    def validate_context(self, value):
        required = {
            "width",
            "height",
            "background",
            "objects",
            "selection",
        }
        if (
            not isinstance(value, dict)
            or not required <= value.keys()
            or set(value) - (required | {"transition", "durationSec"})
        ):
            raise serializers.ValidationError("Supply the current page and selection.")
        for key in ("width", "height"):
            size = value[key]
            if isinstance(size, bool) or not isinstance(size, (int, float)) or not math.isfinite(size):
                raise serializers.ValidationError("Invalid canvas size.")
            if not 1 <= size <= 20000:
                raise serializers.ValidationError("Invalid canvas size.")
        if not isinstance(value["objects"], list) or len(value["objects"]) > 500:
            raise serializers.ValidationError("AI supports up to 500 layers per page.")
        seen = set()
        for obj in value["objects"]:
            if not isinstance(obj, dict) or not {"id", "type"} <= obj.keys():
                raise serializers.ValidationError("Invalid layer context.")
            if set(obj) - (
                FIELDS
                | {"id", "type", "locked", "originX", "originY", "scaleX", "scaleY", "animation", "effects"}
            ):
                raise serializers.ValidationError("Context contains unsupported layer fields.")
            if not isinstance(obj["id"], str) or not 1 <= len(obj["id"]) <= 200 or obj["id"] in seen:
                raise serializers.ValidationError("Invalid or duplicate layer id.")
            if not isinstance(obj["type"], str) or len(obj["type"]) > 80:
                raise serializers.ValidationError("Invalid layer type.")
            seen.add(obj["id"])
        if not isinstance(value["selection"], list) or any(
            not isinstance(item, str) or item not in seen for item in value["selection"]
        ):
            raise serializers.ValidationError("Invalid selection.")
        if not isinstance(value["background"], str) or len(value["background"]) > 80:
            raise serializers.ValidationError("Invalid background context.")
        # Budget the context before any billable call; reject NaN and nested oversized data.
        try:
            size = len(json.dumps(value, allow_nan=False))
        except (ValueError, TypeError, RecursionError):
            raise serializers.ValidationError("Invalid canvas context.")
        if size > 100000:
            raise serializers.ValidationError("Canvas context is too large.")
        return value

    def validate_messages(self, value):
        for message in value:
            if (
                set(message) != {"role", "content"}
                or not isinstance(message["role"], str)
                or message["role"] not in {"user", "assistant"}
            ):
                raise serializers.ValidationError("Invalid conversation.")
            if not isinstance(message["content"], str) or len(message["content"]) > 8000:
                raise serializers.ValidationError("Conversation message is too large.")
        return value

    def validate_tool_results(self, value):
        from .tools import BY_NAME

        for result in value:
            if (
                set(result) != {"id", "name", "result"}
                or not isinstance(result["name"], str)
                or result["name"] not in BY_NAME
            ):
                raise serializers.ValidationError("Invalid design tool result.")
            try:
                size = len(json.dumps(result, allow_nan=False))
            except (ValueError, TypeError, RecursionError):
                raise serializers.ValidationError("Invalid design tool result.")
            if size > 60000:
                raise serializers.ValidationError("Design tool result is too large.")
        return value

    def validate_images(self, value):
        for image in value:
            if (
                set(image) != {"label", "data", "media_type"}
                or not isinstance(image["media_type"], str)
                or image["media_type"] not in {"image/png", "image/jpeg", "image/webp"}
            ):
                raise serializers.ValidationError("Invalid preview image.")
            if (
                not isinstance(image["label"], str)
                or len(image["label"]) > 200
                or not isinstance(image["data"], str)
                or len(image["data"]) > 400000
            ):
                raise serializers.ValidationError("Preview image is too large.")
            try:
                decoded = base64.b64decode(image["data"], validate=True)
                with Image.open(BytesIO(decoded)) as preview:
                    if (
                        preview.width > 2048
                        or preview.height > 2048
                        or preview.format not in {"PNG", "JPEG", "WEBP"}
                    ):
                        raise ValueError("Invalid preview dimensions")
                    preview.verify()
            except (ValueError, OSError, Image.DecompressionBombError):
                raise serializers.ValidationError("Invalid preview image.")
        return value
