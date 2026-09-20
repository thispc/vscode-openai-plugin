# Local CLI Workers

Greenfield VS Code extension foundation for using official, locally installed Codex, Claude Code, and Gemini CLI tools. The extension never embeds a provider API key or private OAuth flow: authentication is performed by each official CLI.

## Development

```sh
npm install
npm run compile
npm test
```

Press `F5` in VS Code to launch the extension host. Use **Local CLI Workers: Run Task**, choose `auto` for usage-aware routing or a worker for a manual override. Output streams to the **Local CLI Workers** output channel. **Open Worker Terminal** creates a visible terminal for interactive provider login and debugging.

Use **Check CLI Authentication** to query each provider's official local auth status. Configure command paths, concurrency, and failure/estimated-usage thresholds under `localCliWorkers.*`. Automatic routing avoids workers over the failure threshold and reassigns an automatically routed task after a process failure. Usage is deliberately marked `unknown` until a task runs, then `estimated` because provider quotas are not queried.

The last 50 task prompts, selected workers, and timestamps are stored in VS Code workspace state for local history. No provider credentials or tokens are persisted. Worker terminals are reused and their process IDs are reported in the output channel. CLI arguments are passed directly to `child_process.spawn` with `shell: false`.

## Architecture

Typed task/usage models feed a provider-neutral adapter interface. Adapters stream stdout/stderr, expose auth checks, and support cancellation. `WorkerManager` performs simple usage-aware selection and tracks failures; the VS Code layer is intentionally thin.
