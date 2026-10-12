"""Codex CLI app-server transport: genuine agentMessage deltas over stdio JSON-RPC."""

import json
import os
import queue
import subprocess
import tempfile
import threading
import time

from django.conf import settings

from apps.core.exceptions import ApiError

from .cli import command_prefix, stop_process
from .design import SYSTEM_PROMPT
from .tools import tool_instructions


def generate_codex_stream(provider, config, data, option_args, on_delta, cancelled):
    prompt = (
        SYSTEM_PROMPT
        + tool_instructions()
        + "\n"
        + json.dumps(
            {
                "canvas": data["context"],
                "conversation": data["messages"],
                "request": data["prompt"],
                "tool_results": data.get("tool_results", []),
            },
            ensure_ascii=False,
        )
    )
    with tempfile.TemporaryDirectory(prefix="doory-codex-") as directory, tempfile.TemporaryFile() as err:
        command = [
            *command_prefix(provider, config),
            "app-server",
            "--stdio",
            "-c",
            'approval_policy="never"',
            *option_args,
        ]
        environment = {**os.environ, **config.get("env", {})}
        process = subprocess.Popen(  # noqa: S603 -- administrator-owned command + self-host/staff gates
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=err,
            cwd=directory,
            env=environment,
            text=True,
            encoding="utf-8",
            start_new_session=os.name != "nt",
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        events = queue.Queue(maxsize=1000)

        def read():
            try:
                for line in process.stdout:
                    if cancelled.is_set():
                        break
                    events.put(line, timeout=settings.AI_REQUEST_TIMEOUT)
            finally:
                events.put(None)

        threading.Thread(target=read, daemon=True).start()

        def send(message):
            process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
            process.stdin.flush()

        send(
            {
                "id": 1,
                "method": "initialize",
                "params": {"clientInfo": {"name": "doory", "title": "Doory AI designer", "version": "1.0.0"}},
            }
        )
        deadline = time.monotonic() + settings.AI_REQUEST_TIMEOUT
        total = 0
        final = ""
        thread_id = None
        deltas = []
        try:
            while not cancelled.is_set():
                if time.monotonic() > deadline:
                    raise ApiError("provider_timeout", "Codex took too long. Try a faster model.", 504)
                try:
                    line = events.get(timeout=0.25)
                except queue.Empty:
                    continue
                if line is None:
                    raise ApiError("cli_error", "Codex app-server stopped before completing the design.", 502)
                total += len(line)
                if total > 8 * 1024 * 1024:
                    raise ApiError("provider_response_large", "Codex stream exceeded the size limit.", 502)
                event = json.loads(line)
                if event.get("error"):
                    raise ApiError(
                        "cli_error",
                        "Codex rejected the app-server request. Check CLI version and model.",
                        502,
                    )
                if event.get("id") == 1:
                    send({"method": "initialized"})
                    params = {
                        "cwd": directory,
                        "approvalPolicy": "never",
                        "sandbox": "read-only",
                        "ephemeral": True,
                    }
                    if data["model"] != "default":
                        params["model"] = data["model"]
                    send({"id": 2, "method": "thread/start", "params": params})
                elif event.get("id") == 2:
                    thread_id = event["result"]["thread"]["id"]
                    inputs = [{"type": "text", "text": prompt}]
                    inputs.extend(
                        {"type": "image", "url": f"data:{image['media_type']};base64,{image['data']}"}
                        for image in data.get("images", [])
                    )
                    send(
                        {
                            "id": 3,
                            "method": "turn/start",
                            "params": {
                                "threadId": thread_id,
                                "input": inputs,
                                "approvalPolicy": "never",
                                "sandboxPolicy": {"type": "readOnly", "networkAccess": False},
                            },
                        }
                    )
                elif event.get("method") == "item/agentMessage/delta":
                    delta = event["params"].get("delta", "")
                    deltas.append(delta)
                    on_delta(delta)
                elif event.get("method") == "item/completed":
                    item = event.get("params", {}).get("item", {})
                    if item.get("type") == "agentMessage":
                        final = item.get("text", final)
                elif event.get("method") == "turn/completed":
                    turn = event.get("params", {}).get("turn", {})
                    if turn.get("status") == "failed" or turn.get("error"):
                        raise ApiError("cli_error", "Codex could not complete this design request.", 502)
                    return {"text": final or "".join(deltas), "actual_tier": None, "usage": {}}
                elif "id" in event and "method" in event:
                    # Never approve native CLI tools or user prompts in a design-generation turn.
                    send(
                        {
                            "id": event["id"],
                            "error": {"code": -32601, "message": "Use Doory design tools only."},
                        }
                    )
            raise ApiError("cancelled", "Design generation cancelled.", 499)
        finally:
            if process.poll() is None:
                stop_process(process)
            process.stdin.close()
            process.stdout.close()
