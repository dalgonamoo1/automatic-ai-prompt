# Recreate the ChatGPT plugin · 0.8.0

[한국어](rebuild-plugin.md)

Keep the complete repository as a ZIP to redeploy this version later. The ZIP contains **server source, build scripts, and instructions**, rather than an already installed plugin. Deploy and complete Install / Connect in the account that will use it.

## Give the source to another AI

Attach the source ZIP and use this request:

```text
Recreate the ChatGPT MCP plugin from the attached Automatic AI Prompt 0.8.0 source.

Preserve its behavior and tests. Build src/chatgpt-worker.js with scripts/build-chatgpt.mjs. For an existing deployment, preserve that Site's ID and audience. For a new deployment, create a private Site in my account and use its actual returned project_id with capabilities: ["mcp"]. Do not copy another account's Site or plugin IDs.

Do not add a separate model API or API key. The host AI must author intent (goal, deliverable, success_criteria, quoted facts, assumptions and material unknowns) and the actual execution_prompt before calling refine_prompt; missing or blank text must fail. Record provisional needs_clarification prompts, then record an updated ready revision linked to the prior prompt_record.id after answers. Quote the exact earlier tool-result text when asked to show a used prompt, rather than present a reconstruction as the original. Do not store conversations permanently on the server.

For follow-ups, use the actual prior record in follow_up.previous to preserve conditions and check replacement/removal evidence. Reuse answered questions and use defaults for minor preferences. After execution, use check_result with actual per-condition check evidence; repair failures and disclose unverified items. Do not claim the server runs tests or verifies semantic correctness.

Verify npm ci --ignore-scripts, npm run check, npm test, and npm run build:chatgpt, then deploy the matching source and build. Reuse the plugin created by Sites and explain Install / Connect and checking in a new chat. Do not guarantee automatic calls in every conversation. Publish publicly or invite other people only if I ask.
```

## Build manually

Use Node.js 22 LTS at version 22.13 or later, or Node.js 24 or later, plus npm. In the extracted source directory:

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run build:chatgpt
```

The output is `dist/server/index.js`. The Sites deployment checkout also needs `.openai/hosting.json` containing the exact Site ID returned for your account:

```json
{
  "project_id": "your exact Site ID from Sites",
  "capabilities": ["mcp"]
}
```

Build again to emit the deployment manifest, push the matching source to the Site's source repository, and deploy the build. The archive must include root `.openai/hosting.json` and `dist/server/index.js`. See the [full deployment guide](advanced.en.md#deploy-the-chatgpt-worker).

Install and connect **Automatic AI Prompt** under **Plugins → Personal → Created by you**, then select it in a new chat. Republishing an existing Site refreshes its plugin tools. Pushing to the public GitHub repository alone does not update the hosted server.

## Main files

- [ChatGPT server](../src/chatgpt-worker.js): `/mcp`, `/health`, and connection page
- [Prompt contract](../src/prompt.js): required text, provisional/ready state, exact documents and revisions
- [Tool description](../src/tool-definition.js): automatic-use guidance
- [Build script](../scripts/build-chatgpt.mjs): single-file Worker build
- [English instructions](../examples/standing-instructions.en.md) · [Korean instructions](../examples/standing-instructions.ko.md)
- `package.json`, `package-lock.json`, and `test/`: dependencies and regression checks

## Share with other people

The source is shareable under the MIT license. The public repository contains no account-specific deployment IDs, secrets, or user conversation records. Do not add personal installation settings, credentials, or real tool-call records to a backup ZIP.

**Official guidance as of November 10, 2026:** Personal and Pro accounts cannot directly share a Site-hosted plugin with other ChatGPT users by invitation or link. Business and Enterprise workspaces can share with coworkers who have plugin and Site access; each recipient installs and connects independently. Sharing a Site URL or making the Site public does not share its plugin.

Personal users can share this source and deploy separately in their own accounts. A service for multiple users requires a separately hosted HTTPS MCP endpoint and supported connections for each ChatGPT user. Availability depends on account, plan, and administrator settings.

[Official Sites plugin sharing guidance](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)
