"""Read-only stdio MCP image bridge for self-hosted CLIs. Exposes no filesystem tools."""

import json
import sys
from pathlib import Path


def serve(images, source, target):
    definition = {
        "name": "read_design_snapshot",
        "description": "See rendered Doory design and motion filmstrips for this turn.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    }
    for line in source:
        try:
            request = json.loads(line)
            if "id" not in request:
                continue
            method = request.get("method")
            if method == "initialize":
                result = {
                    "protocolVersion": request.get("params", {}).get("protocolVersion", "2024-11-05"),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "doory-design-snapshots", "version": "1.0.0"},
                }
            elif method == "tools/list":
                result = {"tools": [definition]}
            elif method == "tools/call" and request.get("params", {}).get("name") == definition["name"]:
                content = []
                for image in images:
                    content.extend(
                        [
                            {"type": "text", "text": image["label"]},
                            {"type": "image", "data": image["data"], "mimeType": image["media_type"]},
                        ]
                    )
                result = {"content": content, "isError": False}
            elif method == "ping":
                result = {}
            else:
                target.write(
                    json.dumps(
                        {
                            "jsonrpc": "2.0",
                            "id": request["id"],
                            "error": {"code": -32601, "message": "Method not found"},
                        }
                    )
                    + "\n"
                )
                target.flush()
                continue
            target.write(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}) + "\n")
            target.flush()
        except (ValueError, TypeError, KeyError):
            continue


if __name__ == "__main__":
    serve(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")), sys.stdin, sys.stdout)
