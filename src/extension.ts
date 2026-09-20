import * as vscode from 'vscode';
import { readConfig } from './config';
import { createAdapters } from './adapters';
import { WorkerAdapter, WorkerId } from './models';
import { WorkerManager } from './manager';
import { WorkerSelection } from './models';

let manager: WorkerManager;
let status: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let adapters: Record<WorkerId, WorkerAdapter>;
let contextState: vscode.Memento;
const terminals = new Map<WorkerId, vscode.Terminal>();
const historyKey = 'taskHistory';

export function activate(context: vscode.ExtensionContext): void {
  const config = readConfig();
  adapters = createAdapters(config.commands);
  manager = new WorkerManager(adapters, config.maxConcurrentTasks, config.failureThreshold, config.usageThreshold);
  contextState = context.workspaceState;
  output = vscode.window.createOutputChannel('Local CLI Workers');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'localCliWorkers.runTask'; status.text = '$(hubot) Workers'; status.tooltip = 'Run a local CLI worker task'; status.show();
  context.subscriptions.push(status, output);
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.runTask', runTask));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.cancelTask', () => manager.cancelActive()));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.showWorkers', showWorkers));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.checkAuth', checkAuth));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.openWorkerTerminal', openWorkerTerminal));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('localCliWorkers')) vscode.window.showInformationMessage('Local CLI Workers: reload the window to apply configuration changes.'); }));
}

async function runTask(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const prompt = await vscode.window.showInputBox({ prompt: 'Describe the task for a local CLI worker', placeHolder: 'Review this file and suggest improvements' });
  if (!prompt) return;
  const profiles = readConfig().profiles;
  const worker = await vscode.window.showQuickPick([
    { label: 'Auto', description: 'Usage-aware routing', value: 'auto' as WorkerSelection },
    ...(['codex', 'claude', 'gemini'] as WorkerId[]).map(id => ({ label: profiles[id].label, description: profiles[id].modelLabel, value: id as WorkerSelection }))
  ], { placeHolder: 'Select worker (manual override)' });
  if (!worker) return;
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? editor?.document.uri.fsPath ?? process.cwd();
  output.clear(); output.show(true); status.text = `$(sync~spin) ${worker.value}`;
  try {
    const result = await manager.run({ prompt, cwd, worker: worker.value, timeoutMs: readConfig().taskTimeoutMs }, chunk => output.append(chunk.text));
    const history = contextState.get<Array<{ prompt: string; worker: string; at: number }>>(historyKey, []);
    await contextState.update(historyKey, [...history.slice(-49), { prompt, worker: result.worker, at: Date.now() }]);
    status.text = `$(hubot) ${result.worker}`;
    if (result.exitCode !== 0) vscode.window.showErrorMessage(`${result.worker} exited with code ${result.exitCode}`);
  } catch (error) { status.text = '$(hubot) Workers'; vscode.window.showErrorMessage(String(error)); }
}
async function showWorkers(): Promise<void> {
  const profiles = readConfig().profiles;
  const items = manager.snapshots().map(s => `${profiles[s.worker].label} (${profiles[s.worker].modelLabel}): ${s.running ? 'running' : 'idle'} · completed ${s.completed} · failures ${s.failures} · usage ${s.usage.state}${s.usageThresholdReached ? ' (threshold)' : ''}`);
  await vscode.window.showQuickPick(items, { placeHolder: 'Worker usage' });
}
async function openWorkerTerminal(): Promise<void> {
  const worker = await vscode.window.showQuickPick(['codex', 'claude', 'gemini'], { placeHolder: 'Open visible terminal for worker' });
  if (!worker) return;
  const existing = terminals.get(worker as WorkerId);
  if (existing) { existing.show(); return; }
  const terminal = vscode.window.createTerminal({ name: `Worker: ${worker}`, cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
  terminals.set(worker as WorkerId, terminal);
  terminal.processId.then(id => output.appendLine(`[${worker}] terminal process ${id ?? 'unknown'} started`));
  terminal.show();
}
async function checkAuth(): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const results = await Promise.all((Object.keys(adapters) as WorkerId[]).map(async id => [id, await adapters[id].checkAuth(cwd)] as const));
  const message = results.map(([id, result]) => `${id}: ${result.detail}`).join('\n');
  output.appendLine(`Authentication check:\n${message}`);
  vscode.window.showInformationMessage(message);
}
export function deactivate(): void { manager?.cancelActive(); }
