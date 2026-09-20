# Local CLI Workers

Greenfield VS Code extension foundation for using official, locally installed Codex, Claude Code, and Gemini CLI tools. The extension never embeds a provider API key or private OAuth flow: authentication is performed by each official CLI.

## Development

```sh
npm install
npm run compile
npm test
```

Press `F5` in VS Code to launch the extension host. The **Agent Tasks** sidebar is a persistent, local task history: it shows queued/running/completed/failed/cancelled work and can resume finished tasks. Use **Local CLI Workers: Run Task**, choose `auto` for usage-aware routing or a worker for a manual override. Output streams live to the **Local CLI Workers** output channel. **Open Worker Terminal** creates a visible terminal for interactive provider login and debugging; process IDs and lifecycle events are logged.

Use **Check CLI Authentication** to query each provider's official local auth status. Configure command paths, concurrency, and failure/estimated-usage thresholds under `localCliWorkers.*`. Automatic routing avoids workers over the failure threshold and reassigns an automatically routed task after a process failure. Usage is deliberately marked `unknown` until a task runs, then `estimated` because provider quotas are not queried.

The last 100 task records (including status, output activity, context, selected workers, and timestamps) are stored in VS Code workspace state for local history. No provider credentials or tokens are persisted. Before prompts that appear destructive or privileged (for example `delete`, `deploy`, `sudo`, or `force`), the extension requests explicit VS Code approval. This is a guardrail, not a sandbox: review CLI output and provider permissions. Active editor file, language, and selection are included as task context. Cancellation sends SIGTERM to the local process; failed or cancelled tasks can be resumed.

Provider commands remain official local CLIs. The extension passes arguments directly to `child_process.spawn` with `shell: false`, does not call provider APIs, and never stores API keys or private OAuth tokens. Configure command paths, concurrency, timeout, and failure/estimated-usage thresholds under `localCliWorkers.*`.

## Architecture

Typed task/usage models feed a provider-neutral adapter interface. Adapters stream stdout/stderr, expose auth checks, and support cancellation. `WorkerManager` performs usage-aware selection, retries automatic routes after process failures, and emits lifecycle events. The VS Code layer owns the persistent task store and TreeDataProvider.

## Packaging

```sh
npm test
npm run package   # creates a .vsix when the `vsce` CLI is available
code --install-extension local-cli-workers-0.1.0.vsix
```
