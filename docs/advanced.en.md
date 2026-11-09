# Advanced configuration and development

[한국어](advanced.md) · **English**

[← Back to installation and usage](../README.en.md)

Use this guide for configuration paths, manual connections, remote deployment, and MCP interfaces. For normal installation, use the single setup command in the README.

## Scope of automatic setup

| App | MCP configuration | Workflow instructions |
| --- | --- | --- |
| Codex | `~/.codex/config.toml` | `~/.codex/AGENTS.md`, or the existing override file |
| Claude Code | `~/.claude.json` | `~/.claude/CLAUDE.md` |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/GEMINI.md` |
| Cursor | `.cursor/mcp.json` in the current project | `.cursor/rules/intent-bridge.mdc` |
| VS Code | `.vscode/mcp.json` in the current project | `.github/instructions/intent-bridge.instructions.md` |
| Claude Desktop | The OS-specific Claude configuration file | Workflow instructions supplied by the MCP server |

Run setup from the intended project folder for Cursor and VS Code. Run it again in another folder to connect another project. Claude Desktop setup does not write another CLI's global instruction files. Automatic tool use depends on how the client applies server instructions. Any client-level tool approvals or trust settings are handled in that app.

The default persistent server location is `~/.local/share/automatic-ai-prompt` on macOS/Linux and `%LOCALAPPDATA%/automatic-ai-prompt` on Windows. Removing the downloaded source or npm's temporary cache does not remove the registered server.

### Direct selection, updates, and previews

Select multiple apps without the menu:

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --client codex --client claude_code
```

Use `setup` to select and register new connections. Use the separate `update` command to refresh existing connections:

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git update
```

Update uses `connections.json` in the installation folder to find the registered apps and projects. It does not reopen the selection menu. Existing server options and instruction preferences are preserved. Entries you removed or replaced with another server are not recreated. Managed instruction blocks are replaced rather than duplicated.

For installations such as version 0.2 that have no connection catalog, update discovers existing entries in user settings and the current project. Run `update` once from any other previously connected project to include it in future updates. If you installed with a custom `--install-dir` or `--config-dir`, use the same paths when updating.

Older server versions are retained for apps that may still be running. To pin a Git commit, append `#COMMIT_SHA` to the Git URL.

Preview the affected paths without installing or changing configuration:

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --client codex --dry-run
```

To preview updates to existing connections:

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git update --dry-run
```

Additional options are `--project PATH`, `--install-dir PATH`, and `--no-instructions`. For automation or isolated setup, use `--config-dir PATH` to select a configuration root instead of the default user directory. Run `setup --help` or `update --help` for all options. The current CLI menu and help text are in Korean.

The setup flow follows the approach of [REA setup](https://rea.tools/get-started/): select a client and register MCP together with workflow instructions. This project's implementation was written for this tool.

## List, diagnose, and remove connections

These commands manage local MCP connections registered by this project's setup command. They inspect saved connection records and existing installations in the current project. Use `--client codex` to select an app. With `--project PATH`, only that project's Cursor and VS Code connections are included. Supply `--install-dir` and `--config-dir` too if you used custom installation paths.

### List connections: `list`

Shows registered apps, projects, configuration paths, and whether entries were removed or replaced by another server. It does not start servers or change configuration files.

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git list --json
```

### Diagnose connections: `doctor`

Checks the registered launch path and managed instructions, then uses the configured Node.js and environment to test MCP initialization and tool calls. It does not change configuration or print environment values. Disabled connections are reported without being started.

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git doctor --client codex --json
```

The JSON `healthy` field reports the result. The exit code is 0 when every selected connection is healthy, and 1 when a problem is found or no connections are selected. Diagnostics cover registration, MCP server responses, and managed instructions. They do not verify automatic tool use or task quality inside each AI app.

### Remove connections: `uninstall`

By default, removes this tool's MCP entry and marked instruction block from every registered connection. Entries replaced by another server are left intact. Other MCP servers, user instructions, and user additions to rule files are preserved. Project rule files created by this tool are deleted only when they contain no additional user content.

Preview the changes first:

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git uninstall --dry-run
```

Remove only one app:

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git uninstall --client codex
```

Files are backed up before changes or deletion. If applying the plan fails, earlier changes are rolled back. Server files and backups are retained for running sessions and recovery. Restart your AI apps afterward. All three commands support `--help` and structured output with `--json`.

## Manual connection and development setup

Use this if you prefer to manage configuration yourself.

```bash
git clone https://github.com/dalgonamoo1/automatic-ai-prompt.git
cd automatic-ai-prompt
npm ci --ignore-scripts
```

With GitHub CLI, you can also clone with `gh repo clone dalgonamoo1/automatic-ai-prompt`.

Print the configuration for your app. These commands **only print configuration**; they do not edit existing settings. Merge the relevant server entry into your configuration rather than replacing entries for other servers.

| App | Print command | Destination |
| --- | --- | --- |
| Claude Desktop | `npm run --silent config -- claude` | `mcpServers` in the local MCP configuration |
| Cursor | `npm run --silent config -- cursor` | `mcpServers` in MCP settings or `.cursor/mcp.json` |
| VS Code | `npm run --silent config -- vscode` | `servers` in the workspace's `.vscode/mcp.json` |
| Codex | `npm run --silent config -- codex` | MCP configuration in `~/.codex/config.toml` |

The generated configuration includes the actual installation path and Node executable, so you do not need to type those paths. Restart the connection and check that `refine_prompt` appears. Menu names and MCP support vary by app version.

### Workflow instructions for manual setup

`setup` installs workflow instructions for supported clients. For manual connections, add the [English standing instructions](../examples/standing-instructions.en.md) to your app's user instructions or project rules. [Korean instructions](../examples/standing-instructions.ko.md) are also available. An MCP connection does not intercept every chat message.

After adding the instructions, make an ordinary request:

The default scope covers tasks that create, edit, analyze, summarize, plan, code, or produce another deliverable, including detailed requests and small edits. Question-shaped requests such as "Can you analyze this?" count as tasks when they ask for work. Greetings, casual conversation, and simple informational questions are excluded. Call once per new task, without another call for clarification answers in the same task. The instructions require the AI to disclose unavailable or failed calls instead of claiming it used the tool.

> Write an email to my manager saying the deadline has moved from Friday to Monday. We need more time for review, and I do not want it to sound like an excuse.

The AI uses the schedule and reason already provided to formulate its internal prompt, then writes the email. It should not stop for information such as a name that can use a placeholder. It asks only when missing information would materially change the content or correctness.

If you want only a prompt, say so explicitly:

> Write a prompt for getting feedback on a junior developer portfolio. Give me the prompt only.

Each app needs its own initial connection. One app's MCP settings do not automatically transfer to another. Behavior and quality depend on how the host AI follows the tools and instructions.

### Check automatic use

1. Run `update` for an existing installation, fully restart the AI app, and open a new chat. An installation made with `--no-instructions` keeps that choice during updates. To add local workflow instructions, run `setup` and select that AI again.
2. Check that the current chat can use `refine_prompt` from the `intent-bridge` server. A registered MCP entry does not prove that a particular chat can call it.
3. Without naming the tool, ask "Make a one-week English study plan with 30 minutes per day". Check the app's tool activity for a `refine_prompt` call; a completed plan alone does not prove a call occurred.
4. If the AI asks an essential question, answer it and confirm that it continues without another call or an extra execute request. Simple informational questions such as "What is photosynthesis?" are excluded from automatic calls.

`doctor` checks server connectivity rather than the AI's tool selection. If automatic calls are missing, check whether the workflow instructions are applied and the tool is available in that chat. Instructions cannot activate a tool that the app does not expose.

### Run directly through npx

If you manage MCP configuration yourself, this configuration runs the server without a local clone. It installs the public GitHub source; the package is not published to the npm registry.

```json
{
  "mcpServers": {
    "intent-bridge": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=git+https://github.com/dalgonamoo1/automatic-ai-prompt.git",
        "intent-bridge-mcp"
      ]
    }
  }
}
```

The first run requires Git and network access. Append `#COMMIT_SHA` to the Git URL to pin a tested version.

## Deploy the ChatGPT Worker

`src/chatgpt-worker.js` exposes remote MCP tools for a ChatGPT plugin. It shares the local server's request schema, automatic-use instructions, and brief-generation function. It makes no model API calls and stores no conversations. It supports MCP `2026-07-28` discovery, tool listing, and calls, plus initialization for existing clients. The local prompt and resource interfaces remain available through the stdio / Express server.

Build for development:

```bash
npm ci --ignore-scripts
npm test
npm run build:chatgpt
```

The output is a single Web Fetch API ES module at `dist/server/index.js`. Use `GET /health` for health checks and `POST /mcp` as the connection endpoint. `GET /` provides Korean and English connection instructions.

For Sites, create a private Site and add this `.openai/hosting.json` in its **deployment checkout**. Use the exact Site ID returned for your own deployment rather than copying another account's ID:

```json
{
  "project_id": "your exact Site ID from Sites",
  "capabilities": ["mcp"]
}
```

Build again to produce `dist/.openai/hosting.json`. Push the matching source to the Site's source repository and deploy the build output. When the owner publishes with the MCP capability, Sites creates the connected plugin. In ChatGPT, open **Plugins → Personal → Created by you → Automatic AI Prompt → Install / Connect**, then select it in a new chat. The deployed Site's `/` page also explains the connection steps.

Sites checks sign-in and Site access before forwarding requests. For other hosting platforms, configure HTTPS and access control there, then register a custom MCP server in ChatGPT. This Worker does not implement its own OAuth or account authentication, and the Express server's `MCP_AUTH_TOKEN` setting does not apply to it.

A private Site and its plugin belong to the deploying account. Sharing with other users requires the appropriate Site and plugin access settings. A public GitHub repository does not grant access to another account's private deployment. See the official [ChatGPT MCP guide](https://learn.chatgpt.com/docs/extend/mcp).

## Connect apps that require a server URL

The server supports **Streamable HTTP** as well as local `stdio`. Deploy it to an HTTPS server reachable by your AI app, then register `https://YOUR_HOST/mcp`. The app must support remote MCP or custom apps; availability depends on the account, plan, and administrator settings. An AI app running on another server cannot directly reach your computer's `localhost`.

```bash
npm run start:http
```

The default endpoint is `http://127.0.0.1:3000/mcp`; the health check is `/health`. It supports JSON responses and stateless MCP. It does not provide standalone SSE streams, stored sessions, or the older HTTP+SSE transport.

### Deploy to Render

The repository includes a Dockerfile and `render.yaml`. If you use a private fork, Render needs read access to that repository.

1. Select this repository when creating a Blueprint in Render.
2. Review the plan and settings, then deploy under Render's hosting terms.
3. Check `/health` on the assigned domain.
4. Register `https://YOUR_HOST/mcp` in your AI app.

Render's `RENDER_EXTERNAL_HOSTNAME` is allowed automatically. Sleep and startup delays on a free instance can affect MCP connectivity. **Uploading source to GitHub does not host the server.** A remote deployment is a separate step.

For other hosting services, configure these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` for containers or external access |
| `PORT` | `3000` | HTTP port |
| `MCP_ALLOWED_HOSTS` | Localhost addresses plus the Render hostname | Exact hostnames, separated by commas; no schemes, ports, or wildcards |
| `MCP_AUTH_TOKEN` | Unset | Optional Bearer authentication for `/mcp` |

Store `MCP_AUTH_TOKEN` as a secret environment variable in your hosting service, not in the repository. This authentication method requires a client that supports a custom Authorization header. An OAuth login server is not implemented; clients that require OAuth need a separate authentication layer. For public operation, use HTTPS and your hosting service's access and request limits.

## MCP interfaces

### Tool: `refine_prompt`

```json
{
  "request": "Help me prepare a competitor analysis",
  "context": "Our service is a secondhand marketplace for university students in Korea",
  "constraints": ["Do not invent unverified figures"],
  "desired_output": "A comparison and key implications",
  "language": "auto",
  "mode": "execute",
  "clarification": "minimal"
}
```

Only `request` is required. Supply context, constraints, and the output format only when known. The default language is `auto`. The default clarification mode is `minimal`; use `ask_first` when you want essential questions first.

The default `mode` is `execute`: the host AI creates an internal prompt, carries out the original task, and shows the result. If the user wants only a prompt, the host should select `prompt_only` and return the prompt without executing its embedded task. An explicit prompt-only request takes precedence over the default mode.

Input limits: request 12,000 characters; context 16,000; up to 20 constraints of 2,000 characters each; output description 4,000. Oversized input returns an error rather than being silently truncated.

The returned `source`, `draft_prompt`, `rewrite_guidance`, and `workflow` are **working material for the host AI**. The default `status: "host_execution_required"` means that the host must formulate the internal prompt and complete the task. `prompt_only` returns `host_rewrite_required`. The host also decides whether clarification is necessary. It updates the conversation context and resumes work after the user's answers; the server does not store conversation state.

### Prompt: `refine`

Clients that support MCP Prompts can pass `request` and optional `context`, `language`, and `mode`. The default is to clarify intent and execute the task. Only `mode: "prompt_only"` returns just a prompt. If the client has no Prompts UI, use the `refine_prompt` tool.

### Resource: `intent-bridge://guide`

Provides principles for preserving intent, handling missing information, and rewriting prompts.

## Data handling

- The server code does not save requests to files or a database.
- It creates no user accounts or conversation memory. The host supplies relevant prior context through `context`.
- It contains no external model API calls, analytics, or tracking code.
- With remote HTTP, input is sent to your selected server, and tool results are returned to the host AI. The AI app and hosting provider have their own data handling and logging policies.
- Input is separated as JSON data, and the host is instructed to ignore attempts to change the governing instructions. This does not guarantee protection against prompt injection.

## Development and verification

```bash
npm ci --ignore-scripts
npm run check
npm test
```

Tests use real MCP SDK clients with a stdio child process and an HTTP server. They cover initialization, execution and prompt-only mode delivery, tools, prompts, resources, invalid input, concurrent request isolation, Host and Origin validation, optional authentication, and body limits.

Installer tests use temporary folders to check all six client configurations, preservation of JSONC comments and unrelated settings, TOML tables and inline tables, multiline strings, backups, idempotent updates, rollback after write failure, concurrent-edit detection, and a no-change dry run. CI is configured for Node 22 and 24 on Windows, macOS, and Linux.

These tests verify the protocol and data preservation. They do not establish prompt quality in every AI app or validate a remote hosting deployment. Quality depends on the host model and the context provided.

MIT License
