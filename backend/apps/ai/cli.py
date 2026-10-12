"""Self-hosted CLI adapters. Only administrator-owned command prefixes; never shell strings."""

import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import suppress
from pathlib import Path

from django.conf import settings

from apps.core.exceptions import ApiError

from .design import SYSTEM_PROMPT
from .tools import tool_instructions
from .transports import MAX_RESPONSE_BYTES, text_blocks


def command_prefix(provider, config):
    command = config.get("command", [provider.command])
    if (
        not isinstance(command, list)
        or not command
        or any(not isinstance(arg, str) or not arg for arg in command)
    ):
        raise ApiError("invalid_cli_command", "Configure command as an administrator-owned JSON array.")
    executable = shutil.which(command[0])
    if not executable:
        raise ApiError("cli_not_installed", f"Install {provider.name} on the Doory backend host.", 503)
    if Path(executable).suffix.lower() in {".cmd", ".bat", ".ps1"}:
        raise ApiError(
            "cli_wrapper", "Configure a native executable or [node, absolute CLI .js path] on Windows.", 503
        )
    return [executable, *command[1:]]


def build_command(provider, config, model, option_args, workspace, prompt):
    prefix = command_prefix(provider, config)
    provider_id = provider.id
    stdin = prompt
    if provider_id == "codex-cli":
        args = [
            "exec",
            "--json",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "-c",
            'approval_policy="never"',
            "-c",
            "mcp_servers={}",
        ]
    elif provider_id in {"claude-code-cli", "codebuddy-cli", "qoder-cli"}:
        args = [
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "text",
            "--no-session-persistence",
            "--tools",
            "",
            "--mcp-config",
            '{"mcpServers":{}}',
            "--strict-mcp-config",
            "--setting-sources",
            "user",
        ]
        if provider_id != "qoder-cli":
            args += ["--settings", '{"disableAllHooks":true}']
        else:
            args.remove("--verbose")
    elif provider_id == "opencode-cli":
        args = ["run", "--format", "json", "--pure"]
        (workspace / "opencode.json").write_text(json.dumps({"permission": {"*": "deny"}}), encoding="utf-8")
    elif provider_id == "cursor-cli":
        args = ["-p", "--output-format", "stream-json", "--mode", "ask", "--workspace", str(workspace)]
        (workspace / ".cursor").mkdir()
        (workspace / ".cursor" / "cli.json").write_text(
            json.dumps({"permissions": {"allow": [], "deny": ["Shell(*)", "Read(*)", "Write(*)", "Mcp(*)"]}}),
            encoding="utf-8",
        )
    elif provider_id == "grok-cli":
        prompt_path = workspace / "prompt.txt"
        prompt_path.write_text(prompt, encoding="utf-8")
        args = [
            "--no-leader",
            "--prompt-file",
            str(prompt_path),
            "--output-format",
            "streaming-json",
            "--disable-web-search",
            "--no-subagents",
            "--no-plan",
            "--disallowed-tools",
            "run_terminal_command,read_file,search_replace,list_dir,grep,spawn_subagent,scheduler_create,monitor,search_tool,use_tool,workflow,image_gen,image_edit,write,bash,shell,edit,Glob,Grep",
            "--verbatim",
        ]
        stdin = ""
    elif provider_id == "pi-agent-cli":
        args = [
            "--mode",
            "json",
            "--print",
            "--no-session",
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-context-files",
            "--no-tools",
        ]
    else:
        raise ApiError("invalid_provider", "Unknown CLI provider.")
    if model and model != "default":
        if provider_id == "pi-agent-cli" and "/" in model:
            vendor, model_id = model.split("/", 1)
            args += ["--provider", vendor, "--model", model_id]
        else:
            args += ["--model", model]
    args += option_args
    if provider_id == "codex-cli":
        args += ["-"]
    return [*prefix, *args], stdin


def extract_cli_text(output):
    """Parse complete assistant messages only; ignore thinking, tools and partial text."""
    messages = []
    final = None
    deltas = []
    for line in output.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if ("operations" in event or "tool_calls" in event) and "message" in event:
            return json.dumps(event)
        kind = event.get("type")
        if kind in {"error", "turn.failed"}:
            raise ApiError("cli_error", "CLI could not complete this request. Check login and model.", 502)
        if kind == "result":
            if event.get("is_error"):
                raise ApiError(
                    "cli_error", "CLI could not complete this request. Check login, model and options.", 502
                )
            if isinstance(event.get("result"), str):
                final = event["result"]
        elif kind == "item.completed" and event.get("item", {}).get("type") == "agent_message":
            messages.append(event["item"].get("text", ""))
        elif kind in {"assistant", "message_end"}:
            message = event.get("message", {})
            if message.get("role", "assistant") == "assistant":
                content = message.get("content", [])
                messages.append(content if isinstance(content, str) else text_blocks(content))
        elif kind == "text" and isinstance(event.get("part", {}).get("text"), str):
            messages.append(event["part"]["text"])
        elif kind == "text" and isinstance(event.get("data"), str):
            deltas.append(event["data"])
        elif kind == "message" and event.get("role") == "assistant":
            messages.append(text_blocks(event.get("content", [])))
    if final is not None:
        return final
    if messages:
        return "\n".join(messages)
    if deltas:
        return "".join(deltas)
    raise ApiError("cli_response_invalid", "CLI returned no complete assistant response.", 502)


def stop_process(process):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)  # noqa: S603,S607
    else:
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
    process.wait()


def attach_cli_images(provider, command, stdin, workspace, images):
    if not images:
        return command, stdin, {}
    provider_id = provider.id
    paths = []
    for index, image in enumerate(images):
        path = workspace / f"preview-{index}.{'png' if image['media_type'] == 'image/png' else 'jpg'}"
        path.write_bytes(base64.b64decode(image["data"]))
        paths.append(str(path))
    if provider_id == "codex-cli":
        command[-1:-1] = [part for path in paths for part in ["--image", path]]
    elif provider_id in {"claude-code-cli", "codebuddy-cli", "qoder-cli"}:
        command[command.index("--input-format") + 1] = "stream-json"
        content = [{"type": "text", "text": stdin}]
        content.extend(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": image["media_type"], "data": image["data"]},
            }
            for image in images
        )
        stdin = json.dumps({"type": "user", "message": {"role": "user", "content": content}}) + "\n"
    elif provider_id == "opencode-cli":
        command += [part for path in paths for part in ["--file", path]]
    elif provider_id == "pi-agent-cli":
        command += ["@" + path for path in paths]
    else:
        snapshots = workspace / "snapshots.json"
        snapshots.write_text(json.dumps(images), encoding="utf-8")
        bridge = str(Path(__file__).with_name("snapshot_mcp.py"))
        server = {"command": sys.executable, "args": [bridge, str(snapshots)]}
        if provider_id == "cursor-cli":
            (workspace / ".cursor" / "mcp.json").write_text(
                json.dumps({"mcpServers": {"doory": server}}), encoding="utf-8"
            )
            (workspace / ".cursor" / "cli.json").write_text(
                json.dumps(
                    {
                        "permissions": {
                            "allow": ["Mcp(doory:read_design_snapshot)"],
                            "deny": ["Shell(*)", "Read(*)", "Write(*)", "WebFetch(*)"],
                        }
                    }
                ),
                encoding="utf-8",
            )
            command += ["--approve-mcps"]
            stdin += "\nCall MCP doory.read_design_snapshot to see the canvas before responding."
        else:
            grok = workspace / ".grok"
            grok.mkdir()
            grok.joinpath("config.toml").write_text(
                "[cli]\nauto_update = false\nuse_leader = false\n[mcp_servers.doory]\ncommand = "
                + json.dumps(sys.executable)
                + "\nargs = "
                + json.dumps(server["args"])
                + "\n",
                encoding="utf-8",
            )
            command += ["--allow", "MCPTool(doory__read_design_snapshot)"]
            prompt_path = workspace / "prompt.txt"
            prompt_path.write_text(
                prompt_path.read_text(encoding="utf-8")
                + "\nCall MCP doory.read_design_snapshot to see canvas before responding.",
                encoding="utf-8",
            )
            auth = os.environ.get("GROK_AUTH_PATH") or str(
                Path(os.environ.get("GROK_HOME", str(Path.home() / ".grok"))) / "auth.json"
            )
            return command, stdin, {"GROK_HOME": str(grok), "GROK_AUTH_PATH": auth}
    return command, stdin, {}


def generate_cli(provider, config, data, option_args, on_delta=None, cancelled=None):
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
    with tempfile.TemporaryDirectory(prefix="doory-ai-") as directory:
        workspace = Path(directory)
        command, stdin = build_command(provider, config, data["model"], option_args, workspace, prompt)
        if on_delta is not None and provider.id in {"claude-code-cli", "codebuddy-cli"}:
            command += ["--include-partial-messages"]
        if on_delta is not None and provider.id == "cursor-cli":
            command += ["--stream-partial-output"]
        command, stdin, image_env = attach_cli_images(
            provider, command, stdin, workspace, data.get("images", [])
        )
        environment = os.environ.copy()
        environment.pop("CLAUDECODE", None)
        environment.update(config.get("env", {}))
        environment.update(image_env)
        if provider.id == "opencode-cli":
            # Config content overrides user permissions; discovery/extensions stay disabled by --pure.
            environment["OPENCODE_CONFIG_CONTENT"] = json.dumps({"permission": {"*": "deny"}})
        with (
            (workspace / "stdout.jsonl").open("w+b") as out,
            tempfile.TemporaryFile() as err,
            tempfile.TemporaryFile() as inp,
        ):
            inp.write(stdin.encode("utf-8"))
            inp.seek(0)
            try:
                process = subprocess.Popen(  # noqa: S603 -- server allowlist + staff + self-host gate
                    command,
                    stdin=inp,
                    stdout=out,
                    stderr=err,
                    cwd=workspace,
                    env=environment,
                    start_new_session=os.name != "nt",
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
            except OSError:
                raise ApiError(
                    "cli_start_failed", "Could not start the configured CLI. Check its executable path.", 503
                )
            deadline = time.monotonic() + settings.AI_REQUEST_TIMEOUT
            reader = (workspace / "stdout.jsonl").open("rb")
            pending = b""

            def publish_lines():
                nonlocal pending
                if on_delta is None:
                    return
                pending += reader.read()
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    if not isinstance(event, dict):
                        continue
                    delta = ""
                    if event.get("type") == "stream_event":
                        inner = event.get("event", {})
                        if inner.get("type") == "content_block_delta":
                            delta = inner.get("delta", {}).get("text", "")
                    elif event.get("type") == "message_update":
                        inner = event.get("assistantMessageEvent", {})
                        if inner.get("type") == "text_delta":
                            delta = inner.get("delta", "")
                    elif event.get("type") == "text":
                        delta = event.get("data") or event.get("part", {}).get("text", "")
                    elif event.get("type") == "assistant":
                        if provider.id != "cursor-cli" or (
                            "timestamp_ms" in event and "model_call_id" not in event
                        ):
                            delta = text_blocks(event.get("message", {}).get("content", []))
                    if isinstance(delta, str) and delta:
                        on_delta(delta)

            try:
                while process.poll() is None:
                    if cancelled is not None and cancelled.is_set():
                        raise ApiError("cancelled", "Design generation cancelled.", 499)
                    publish_lines()
                    if time.monotonic() > deadline:
                        raise ApiError("provider_timeout", "CLI took too long. Try a faster model.", 504)
                    if os.fstat(out.fileno()).st_size + os.fstat(err.fileno()).st_size > MAX_RESPONSE_BYTES:
                        raise ApiError("provider_response_large", "CLI output exceeded the size limit.", 502)
                    time.sleep(0.05)
                if process.returncode != 0:
                    raise ApiError(
                        "cli_error",
                        "CLI failed. Check login, model and supported flags on the backend host.",
                        502,
                    )
                publish_lines()
                out.seek(0)
                output = out.read(MAX_RESPONSE_BYTES + 1)
                if len(output) > MAX_RESPONSE_BYTES:
                    raise ApiError("provider_response_large", "CLI output exceeded the size limit.", 502)
                return {
                    "text": extract_cli_text(output.decode("utf-8", errors="replace")),
                    "usage": {},
                    "actual_tier": None,
                }
            finally:
                reader.close()
                if process.poll() is None:
                    stop_process(process)
