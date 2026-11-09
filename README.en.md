# Automatic AI Prompt

[한국어](README.md) · **English**

**Keep your request short. Let your AI clarify it and do the work.**

Connect it to the AI you already use through MCP. Your AI identifies the goal and constraints, creates an **internal task prompt**, and follows it to complete the task. It asks questions only when essential information is missing.

[How it works](#how-it-works) · [Examples](#examples) · [Connect ChatGPT](#use-in-chatgpt) · [Installation](#installation) · [Commands](#commands) · [Advanced guide](docs/advanced.en.md)

## How it works

![A short request becomes an internal task prompt. If key information is missing, the AI asks questions and incorporates the answers, then completes the task and delivers the result.](docs/assets/workflow.en.svg)

1. **Ask in your own words.** Briefly describe what you want done.
2. **Your AI writes and records the execution prompt.** It authors an actual document with the goal, known constraints, deliverable, and relevant completion checks, then passes it to the tool. Missing or blank prompt text is rejected.
3. **It asks only when needed.** It first records a provisional prompt and essential questions. After your answers, it records the revised prompt before continuing the task.
4. **It completes the task and shows the result.** You do not need to approve an intermediate prompt or say “execute” again.

**The connected AI performs this workflow itself.** The server makes no additional model API calls.

### Do I have to mention the tool every time?

No. The default installation also adds instructions to **use `refine_prompt` first when you assign a task**. Make ordinary requests such as "Write an email", "Summarize this document", "Make a study plan", or "Fix this sentence". Detailed requests and small edits count, as do question-shaped task requests such as "Can you analyze this document?" Simple informational questions, greetings, and casual conversation are excluded.

The AI records the execution prompt before each new task. After clarification answers, it records the updated document before continuing. In MCP lists, the registered server is named **`intent-bridge`** and its tool is **`refine_prompt`**.

Automatic use requires **the tool to be available in the current chat and the AI to apply the workflow instructions**. An MCP server cannot intercept every message or force a call. A listed server may still be unavailable in a particular chat, and a successful `doctor` check does not verify automatic use by the AI. For manual connections or missed automatic calls, add the [standing instructions](examples/standing-instructions.en.md) to your app's user instructions or project rules once, then check in a new chat. Installing with `--no-instructions` skips local workflow instruction files.

### Can I see the prompt that was actually used?

Ask "Show the first prompt you used" or "Show the prompt after my clarification answers". The AI is instructed to quote the **exact document and revision** from the corresponding tool result, rather than present a newly written reconstruction as the original.

The document lives in the **MCP call and response history**; this server does not store conversations permanently. If the record is no longer available in the conversation, the AI must say it cannot retrieve it. The server validates that text exists and meets the input format, but cannot guarantee its semantic quality or that the AI followed it.

**Version 0.5 requires an execution prompt as a tool input.** Update and restart local clients; redeploy the ChatGPT server and open a new chat for the plugin. Users do not have to write this prompt themselves.

## Examples

These examples illustrate how a request turns into completed work. The internal instructions are summarized for explanation; during normal use, you receive the task result rather than the intermediate prompt.

### 1. Add meeting-room booking to an existing project

**Request**

> Add meeting-room booking for our team to the current project. Just make sure reservations do not overlap.

**Essential clarification**

The AI first examines the project's UI, authentication, and data storage. It does not ask you to repeat information available in the code. It checks only the business rules that affect the implementation.

> Can any signed-in team member make a booking? Should overlapping times be blocked only for the same room?

**Your answer**

> Yes. Only block overlaps for the same room. People should only be able to cancel their own bookings.

**Internal task instructions**

- Implement booking creation, viewing, and cancellation using the existing stack, authentication, and storage conventions.
- Reject overlapping bookings for the same room on the server as well as in the UI. Allow simultaneous bookings for different rooms.
- Restrict cancellation to the person who made the booking, with server-side authorization checks.
- Verify overlapping times, concurrent booking requests, and cancellation permissions.

**What you receive**

The AI modifies the code, runs the checks available in the environment, and reports the changes and verification results. You do not need to copy a prompt into another chat or request execution separately. Any checks it could not run are identified explicitly.

### 2. Decide what to improve from customer feedback

**Request**

> Look through the attached customer feedback and help us decide what to fix next. Our goal is to reduce churn, and we have two developers for two weeks. Make it something we can use to make a decision in our meeting.

**Internal task instructions**

- Group feedback by problem and link each problem to the supporting source material.
- Recommend priorities based on reducing churn. Do not invent impact figures or development estimates and present them as facts.
- Suggest a scope that accounts for two developers and two weeks, and label effort estimates as estimates.
- Prepare recommended tasks, selection reasons, items to defer, and open questions so the team can compare options and decide.

**What you receive**

The AI analyzes the attachments and produces evidence-linked priorities and a proposed scope. Since the goal and resource constraints are already provided, it does not ask for them again. It marks anything the available material cannot establish.

If you want the prompt itself, explicitly ask for **“a prompt only.”**

## Use in ChatGPT

For ordinary ChatGPT chats, connect through a **remote MCP plugin**, separately from the local Codex installation. This repository includes a ChatGPT server. No additional model API key or npm publication is needed.

1. Deploy the ChatGPT server once using the [deployment guide](docs/advanced.en.md#deploy-the-chatgpt-worker). A Sites deployment creates a plugin for the deploying account.
2. In ChatGPT, open **Plugins → Personal → Created by you**, find **Automatic AI Prompt**, and complete **Install / Connect**. For a connection deployed by someone else, install the plugin they share with you.
3. Select the plugin in a new chat and make an ordinary request such as "Make a one-week English study plan". You do not need to name the tool every time.
4. Check tool activity for a **`refine_prompt`** call. A listed plugin or a completed answer alone does not prove a call succeeded.

The plugin instructs ChatGPT to use the tool automatically for tasks, but the server cannot force tool selection. Menus and availability depend on the app version, account, and administrator settings. Private deployments are account-specific; making the GitHub repository public does not share a plugin.

## Installation

The commands below install into local clients such as Codex and Claude Code. Use the plugin connection above for ordinary ChatGPT chats. Shared MCP configuration in desktop work modes on the same local host is separate from a remote connection for ordinary chats.

### 1. Check the prerequisites

You need **Node.js 22 LTS (22.13 or later), or Node.js 24 or later**, **npm**, **Git**, and the AI app you want to connect. The repository is public, so no GitHub login or token is required.

For Cursor or VS Code, open your terminal **in the project folder where you want to use it**.

### 2. Run the setup command

Open **Install** in [Commands](#commands), copy the command, and run it.

### 3. Choose your AI apps

![Translated setup illustration: select one or more AI apps by number, install and verify the server, register MCP and workflow instructions, then restart the apps.](docs/assets/setup.en.svg)

Enter your choices to **install the server → verify MCP connectivity → register MCP and workflow instructions in the selected apps**.

- One app: `1`
- Multiple apps: `1,2`
- All apps shown in the menu: `all`

Codex, Claude Code, and Gemini CLI use user-wide settings. Cursor and VS Code use the current project. Claude Desktop is supported on Windows and macOS and uses the workflow instructions provided by the MCP server.

The current setup menu and help text are in Korean. App names, client IDs, and numeric selection work as illustrated. On Linux, Claude Desktop is omitted from the menu. The task output follows the language of your request by default.

### 4. Restart your AI apps

**Fully quit and reopen** each selected app. Then make requests as usual. You do not need to run setup every time.

If an app asks you to trust the server or approve MCP tool use, handle that request in the app.

## Commands

Click a title to expand its command. **Install** lets you choose AI apps. **Update** refreshes existing connections. Use **List connections** to see registered apps and projects, and **Diagnose connections** to check server responses.

**Uninstall** removes this tool's MCP connections and managed instructions. Other settings and user instructions are preserved. Server files and backups are retained.

**Help** shows usage and available options. **Previews** show what would change without modifying AI settings or removing connections.

On Windows, if PowerShell blocks `npx`, **replace `npx` with `npx.cmd`** in any command below.

<details>
<summary>Install</summary>

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup
```

</details>

<details>
<summary>Update</summary>

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git update
```

</details>

<details>
<summary>Diagnose connections</summary>

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git doctor
```

</details>

<details>
<summary>List connections</summary>

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git list
```

</details>

<details>
<summary>Uninstall</summary>

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git uninstall
```

</details>

<details>
<summary>Help</summary>

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git --help
```

</details>

<details>
<summary>Preview installation</summary>

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --dry-run
```

</details>

<details>
<summary>Preview updates</summary>

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git update --dry-run
```

</details>

<details>
<summary>Preview uninstall</summary>

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git uninstall --dry-run
```

</details>

For client filters, JSON output, and other options, see the [Advanced guide](docs/advanced.en.md).

## Good to know

- **Existing settings are preserved:** Other MCP entries stay intact. Changed files are backed up as `.bak-*`. Reinstalling updates the managed instructions without duplicating them.
- **No extra API key:** The server makes no additional model calls. Your AI app's subscription and usage charges still apply.
- **Behavior varies by app:** Automatic tool use and result quality depend on the connected AI and how its app handles MCP instructions.
- **Web apps:** Apps such as ChatGPT web that require a server URL need a separate HTTPS deployment. See [Remote connections](docs/advanced.en.md#connect-apps-that-require-a-server-url).

Configuration paths, manual setup, deployment, and development commands are in the [Advanced guide](docs/advanced.en.md).

MIT License · [License](LICENSE)
