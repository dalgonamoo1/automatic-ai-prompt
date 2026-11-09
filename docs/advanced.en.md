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

Run the same command again to refresh the connection with the latest source. Setup replaces its managed instruction block rather than appending duplicates. Older server versions are retained for apps that may still be running. To pin a Git commit, append `#COMMIT_SHA` to the Git URL.

Preview the affected paths without installing or changing configuration:

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --client codex --dry-run
```

Additional options are `--project PATH`, `--install-dir PATH`, and `--no-instructions`. For automation or isolated setup, use `--config-dir PATH` to select a configuration root instead of the default user directory. Run `setup --help` for all options. The current CLI menu and help text are in Korean.

The setup flow follows the approach of [REA setup](https://rea.tools/get-started/): select a client and register MCP together with workflow instructions. This project's implementation was written for this tool.

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

> Write an email to my manager saying the deadline has moved from Friday to Monday. We need more time for review, and I do not want it to sound like an excuse.

The AI uses the schedule and reason already provided to formulate its internal prompt, then writes the email. It should not stop for information such as a name that can use a placeholder. It asks only when missing information would materially change the content or correctness.

If you want only a prompt, say so explicitly:

> Write a prompt for getting feedback on a junior developer portfolio. Give me the prompt only.

Each app needs its own initial connection. One app's MCP settings do not automatically transfer to another. Behavior and quality depend on how the host AI follows the tools and instructions.

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
