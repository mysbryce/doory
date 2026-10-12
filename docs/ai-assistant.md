# AI designer

The AI designer is a lazy-loaded editor sidebar. Describe a graphic, refine the proposal, review its
preview, then apply it as one undoable change. Generated shapes and text remain editable Fabric layers.
The app shell supplies `EditorServices.ai`; the editor never calls HTTP directly.
The main panel is a conversation and composer. Provider, model, key, speed and reasoning controls live
behind the **Connection settings** gear. Assistant answers render Markdown/GFM, including lists, code
and tables; executable HTML and remote image embeds are disabled.

## Streaming

Every built-in provider uses `POST /api/v1/ai/stream/`. API adapters consume native SSE or NDJSON for
Responses, Chat Completions, Anthropic Messages, Gemini and Ollama. Codex uses its
[app-server stdio protocol](https://developers.openai.com/codex/app-server) and `item/agentMessage/delta`;
other CLIs consume their native JSON event streams while the process is running. Claude and CodeBuddy
enable partial messages; Cursor enables [partial output](https://cursor.com/docs/cli/reference/output-format)
and ignores duplicate buffered flushes. Chunk granularity depends on the installed CLI/provider.
No completed response is split into artificial tokens. Human-facing message text streams into the chat;
edit JSON remains internal until validated. ASGI responses use an async iterator and disable proxy buffering.
Existing custom editor adapters can continue supplying `generate` without `stream`.

## Provider connections

Enter a provider key in Connection settings and use **Test connection / load models**, or enter an exact
model ID. Keys and chat live in an editor-scoped in-memory store, never localStorage, IndexedDB, saved
designs or the public provider catalog. Closing the sidebar preserves the session; closing the tab or
switching designs clears it. Select a **vision-capable model** for the mandatory visual review loop.
Text-only models can reject screenshot attachments; Doory surfaces the error and leaves the canvas intact.

The independently implemented provider registry matches [DBX's provider registry](https://github.com/t8y2/dbx/blob/main/crates/dbx-ai-provider/src/ai.rs)
and adds an explicit OpenRouter connection. No DBX source code is included.

| API providers | Protocol |
| --- | --- |
| OpenAI | Responses |
| Anthropic / Claude, Anthropic-compatible, MiniMax | Messages |
| Google Gemini | generateContent |
| DeepSeek, Moonshot / Kimi, Alibaba / Qwen, Zhipu / GLM | Chat Completions |
| OpenRouter, OpenAI-compatible, Custom API router | Chat Completions (configurable) |
| Ollama | /api/chat |

API adapters support `chat`, `responses`, `anthropic`, `gemini` and `ollama` protocols, native image
attachments and model discovery. Model names are discovered or supplied by the user; a registry entry
does not mean every model from that provider supports vision. Configure compatible gateways with the
appropriate protocol. Anthropic-compatible gateways may set `auth: "bearer"` instead of an `x-api-key`.

## Self-host flag and CLI access

```dotenv
DOORY_SELF_HOSTED=false
DOORY_AI_PROVIDERS={}
DOORY_AI_TIMEOUT=90
```

For Docker Compose, put these variables in the root `.env` (already loaded through `env_file`). For
local Django, use `backend/.env`. The flag defaults to **false** independently of `DEBUG`. Hosted
catalogs omit every CLI provider. Models, options, generation and streaming endpoints reject direct CLI requests
when the flag is false, even for staff. Setting it true still requires staff login and explicit
per-provider enablement. Server keys and server-local Ollama access are also restricted to staff.

CLI providers: Codex, Claude Code, Pi Agent, OpenCode, Cursor, Grok Build, CodeBuddy and Qoder. They run
on the **Doory backend host**, using that host's installed and authenticated CLI. A hosted browser cannot
reach its visitor's local CLI. Docker images do not bundle these CLIs; install them in a custom API
image and supply their authentication under the API service's user. Do not mount a whole home directory
or host filesystem. Native CLI settings are trusted self-host configuration, not an OS security boundary.

Example `DOORY_AI_PROVIDERS` JSON (store compact JSON on one `.env` line):

```json
{
  "codex-cli": {
    "enabled": true,
    "command": ["/usr/local/bin/codex"],
    "models": {
      "your-model-id": {
        "speed": {
          "fast": {"label": "Fast", "args": ["-c", "service_tier=\"fast\""]}
        },
        "effort": {
          "low": {"label": "Low", "args": ["-c", "model_reasoning_effort=\"low\""]},
          "high": {"label": "High", "args": ["-c", "model_reasoning_effort=\"high\""]}
        }
      }
    }
  },
  "claude-code-cli": {"enabled": true, "command": ["/usr/local/bin/claude"]},
  "opencode-cli": {"enabled": true, "command": ["/usr/local/bin/opencode"]},
  "custom": {"enabled": true, "base_url": "https://router.example/v1", "protocol": "chat"}
}
```

The command is an administrator-owned argv array. Browser requests cannot choose executables, command
arguments or arbitrary endpoints. Windows `.cmd`, `.bat` and `.ps1` wrappers are rejected: configure
a native executable or `["node", "C:/absolute/path/to/cli.js"]`. Provider `env` may set the CLI's own
authentication variables. All commands run in a fresh temporary workspace with bounded time/output,
no shell interpolation, and suppressed built-in tools where the CLI supports it. Tool output and
upstream error bodies are not shown to users. CLI model catalogs are administrator-configured; enter
`default` to use the CLI's configured model.

## Speed and reasoning capabilities

Speed/tier and reasoning are separate controls. Provider default omits all option fields. Unsupported
values are rejected before a billable request. Options are exact per-provider/per-model patches,
not invented generic Fast/Balanced/Quality mappings.

OpenRouter exposes latency and throughput routing preferences, using [documented provider sorting](https://openrouter.ai/docs/guides/routing/provider-selection).
These preferences are not guaranteed processing tiers. The two exact OpenAI model IDs verified in the
[official Fast mode documentation](https://developers.openai.com/api/docs/guides/fast-mode), `gpt-6.1-sol`
and `gpt-5.6-sol`, expose Standard/Fast; Codex exposes Fast for those same IDs. Unknown model IDs remain
provider-default until configured. No prefix-based inference is made. Native API responses display the
reported tier, including standard fallback; account eligibility and billing still belong to the provider.

Example API model capabilities:

```json
{
  "openai": {
    "models": {
      "your-model-id": {
        "speed": {
          "standard": {"label": "Standard", "body": {"service_tier": "default"}},
          "fast": {"label": "Fast", "body": {"service_tier": "priority"}}
        },
        "effort": {
          "low": {"label": "Low", "body": {"reasoning": {"effort": "low"}}},
          "high": {"label": "High", "body": {"reasoning": {"effort": "high"}}}
        }
      }
    }
  }
}
```

Configure only parameters the selected model/account supports. `capabilities` declares provider-wide
defaults; `models[modelId]` overrides them. `request_defaults` deep-merges administrator-defined API
parameters. CLI effort uses provider-specific flags, e.g. Claude `--effort`, OpenCode `--variant`,
Pi `--thinking`, Grok `--effort`, Qoder `--reasoning-effort`, and Codex `-c model_reasoning_effort=...`.
Do not assume a flag supported by one CLI works on another. CLI versions vary; update or pin versions
supporting the documented headless flags. Examples: [Codex non-interactive](https://developers.openai.com/codex/noninteractive),
[Claude programmatic use](https://code.claude.com/docs/en/headless), [OpenCode CLI](https://opencode.ai/docs/cli/),
[Pi CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md).

## Agent instruction and tool contracts

`backend/apps/ai/design.py` owns design instructions and bounded edit validation.
`backend/apps/ai/tools.py` owns tool names, descriptions and JSON schemas, exposed by `GET /api/v1/ai/tools/`.
Every API/CLI turn receives these instructions. The provider-neutral JSON tool protocol accepts only
listed tools and validated arguments. `frontend/src/editor/ai/agent.ts` executes at most eight model turns;
`tools.ts` executes calls against an isolated immutable draft. The model cannot run scripts, arbitrary
HTML/SVG, filesystem commands or mutate the live canvas through this protocol.

| Tool | Evidence / behavior |
| --- | --- |
| `get_canvas` | Active draft layers, dimensions, selection, styles and motion |
| `inspect_layout` | Actual Fabric bounds; gaps, edge/center alignment, overlap, margins, clipping, textbox overflow |
| `inspect_styles` | Typography, palette, stroke, effects; raster-sampled text contrast with explicit approximation |
| `get_motion_catalog` | Every registered enter/exit, emphasis and page transition preset, defaults and directions |
| `inspect_motion` | Timeline spans, delays, loops, duration, overlap and unknown-preset issues |
| `capture_canvas` | Real export-pipeline image; optional animation timestamp |
| `capture_motion` | Real animation or transition filmstrip with time/progress labels |
| `apply_design` | Add/update/delete layers, backgrounds/gradients, effects, typography, animation, transition and duration on draft |

The agent inspects baseline layout/styles/motion, edits its draft, then the host forces layout/style/motion
audits and a rendered screenshot back into the model before accepting a final proposal. Motion edits also
produce animation filmstrips; page transitions use the previous page and actual transition renderer.
The model can revise issues through another tool round. A preview rendering failure prevents a final
proposal. A tool error is supplied to the model explicitly; it must not claim that failed check succeeded.
Contrast estimates and overlaps are observations, not automatic accessibility or design verdicts.

Native multimodal API formats deliver screenshot bytes. Codex streaming receives native app-server image
inputs (the non-streaming adapter uses `--image`), Claude/CodeBuddy/Qoder
receive stream-JSON image blocks, OpenCode receives `--file`, Pi receives `@path`. Cursor and Grok receive
a single read-only `read_design_snapshot` MCP tool implemented in `snapshot_mcp.py`. Only the current turn's
validated images are exposed by that bridge; there are no filesystem or mutation tools.

An Apply commits the draft's active page in one history step, preserving its generated IDs and other pages.
A source-page edit/resize/deletion or design switch invalidates pending proposals. Locked layers are
protected. Remote collaborator edits are checked again after asynchronous font loading. Undo/redo uses
the existing editor engine and collaboration history. Operations affect the active page; use Doory's page
controls to choose another page before asking for edits. Creating multiple pages is not an AI operation.

## Limits and validation

Requests: 30 generation/model-discovery calls per minute per user/address, one active generation at a
time, 500 layers in context, 100 operations per turn, three validated preview images per turn, 2 MB JSON
body, 1 MB non-streaming upstream/CLI output, 8 MB native API/Codex streams, eight agent turns. `DOORY_AI_TIMEOUT` defaults to 90 seconds **per provider
turn**, clamped to 5–100 seconds to fit the existing 120-second proxy/worker deadline. Each turn may incur
provider charges. **Stop waiting** aborts the browser loop; a provider request already running may still
finish. No completed or cancelled run applies itself automatically.

Canvas text, selected page content and rendered previews go to the chosen provider. URLs, asset IDs and
private document metadata are omitted from text context. A transition filmstrip includes the previous
page's visual content. Endpoint redirects are rejected; custom/private endpoints are administrator-owned,
never arbitrary browser URLs. Use normal HTTPS deployment and a shared Django cache for multiple workers.

## Verification

```sh
cd backend
python -m pytest apps/ai/tests apps/core/tests/test_config.py
ruff check apps/ai
cd ../frontend
npm run typecheck
npm run lint
npx vitest run src/editor/ai
npm run build
npm run bundle:check
```

Browser fixture (`frontend/playwright.ai.config.ts`) exercises browser → real Django API → deterministic
vision-provider HTTP server → rendered draft/audit → Apply/Undo, plus the mobile sheet. No live model calls:

1. Run `python backend/apps/ai/tests/provider_server.py` (loopback port 8341).
2. Run Django on port 8000 with `DOORY_SELF_HOSTED=false` and
   `DOORY_AI_PROVIDERS={"openai":{"base_url":"http://127.0.0.1:8341/v1"}}` in its process environment.
   Use a development database with migrations applied.
3. Run Vite on port 5173. Run `npx playwright test -c playwright.ai.config.ts`.
   Set `PW_CHROMIUM` to a browser executable if Playwright's Chromium is not installed.

API/CLI adapters, image transport and timeout cleanup are tested with deterministic responses/subprocesses.
Actual installed CLI versions, authenticated provider accounts and paid model output need separate live
verification on the deployment host. The deterministic fixture proves protocol and editor behavior.

Live verification on 2026-10-12 used installed Codex CLI 0.160.0, authenticated through its existing
ChatGPT login, with `gpt-6.1-sol` and administrator-declared Low reasoning. The exact request was
`ทำ Poster รับเกี่ยวกับกีฬาสักอย่าง ให้คิดเนื้อหาเอาได้เลย สวย ๆ`. The browser received live message updates,
the agent created and visually reviewed 26 editable basketball-poster edits, and Doory exported a
1080×1350 PNG with the background included. Other providers have deterministic protocol coverage;
their deployment credentials and installed versions still need live validation.
