import * as vscode from 'vscode';
import { readConfig } from './config';
import { createAdapters } from './adapters';
import { say, newConversation } from './chat';
import { ChatPanel } from './panel';
import { Conversation } from './models';
import { WorkerAdapter, WorkerId, AgentTask, WorkerSelection } from './models';
import { WorkerManager } from './manager';

let manager: WorkerManager;
let status: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let adapters: Record<WorkerId, WorkerAdapter>;
let contextState: vscode.Memento;
const terminals = new Map<WorkerId, vscode.Terminal>();
const historyKey = 'taskHistory';
const tasksKey = 'agentTasks';
let taskTree: TaskTreeProvider;

class TaskItem extends vscode.TreeItem {
  constructor(public readonly task: AgentTask) {
    super(task.prompt.slice(0, 70), task.status === 'running' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${task.status} · ${task.worker}`;
    this.contextValue = task.status === 'running' ? 'runningTask' : 'task';
    this.iconPath = new vscode.ThemeIcon(task.status === 'completed' ? 'pass' : task.status === 'failed' ? 'error' : task.status === 'cancelled' ? 'circle-slash' : task.status === 'running' ? 'loading~spin' : 'circle-large-outline');
    this.command = { command: 'localCliWorkers.resumeTask', title: 'Resume Task', arguments: [task] };
  }
}
class TaskTreeProvider implements vscode.TreeDataProvider<TaskItem> {
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  constructor(private readonly getTasks: () => AgentTask[]) {}
  refresh(): void { this.change.fire(); }
  getTreeItem(item: TaskItem): vscode.TreeItem { return item; }
  getChildren(): TaskItem[] { return this.getTasks().slice().sort((a, b) => b.updatedAt - a.updatedAt).map(t => new TaskItem(t)); }
}

export function activate(context: vscode.ExtensionContext): void {
  const config = readConfig();
  adapters = createAdapters(config.commands, config.codexSandbox, config.modelIds);
  manager = new WorkerManager(adapters, config.maxConcurrentTasks, config.failureThreshold, config.usageThreshold, config.limitedCooldownMs);
  contextState = context.workspaceState;
  taskTree = new TaskTreeProvider(() => contextState.get<AgentTask[]>(tasksKey, []));
  output = vscode.window.createOutputChannel('Local CLI Workers');
  manager.events.on('limited', ({ worker, until, next, reason }: { worker: string; until: number; next?: string; reason?: string }) => {
    const back = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const models = readConfig().modelIds as Record<string, string | undefined>;
    const to = next ? `${next}${models[next] ? ` (${models[next]})` : ''}` : 'nothing left';
    const line = next
      ? `${worker} is out of limit until ${back}. Switching to ${to}.`
      : `${worker} is out of limit until ${back}, and no other worker is free.`;
    output.appendLine(`\n>> ${line}${reason ? `\n   ${worker} said: ${reason}` : ''}`);
    vscode.window.showWarningMessage(line);
  });
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'localCliWorkers.runTask'; status.text = '$(hubot) Workers'; status.tooltip = 'Run a local CLI worker task'; status.show();
  context.subscriptions.push(status, output,
    vscode.commands.registerCommand('localCliWorkers.chat',
      () => ChatPanel.show(context, manager, readConfig().modelIds as Record<string, string | undefined>, readConfig().taskTimeoutMs)),
    vscode.commands.registerCommand('localCliWorkers.chatInput', chat),
    vscode.commands.registerCommand('localCliWorkers.newChat', newChat));
  context.subscriptions.push(vscode.window.registerTreeDataProvider('localCliWorkers.tasks', taskTree));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.runTask', runTask));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.cancelTask', () => manager.cancelActive()));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.showWorkers', showWorkers));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.checkAuth', checkAuth));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.openWorkerTerminal', openWorkerTerminal));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.resumeTask', (task: AgentTask) => runTask(task)));
  context.subscriptions.push(vscode.commands.registerCommand('localCliWorkers.clearHistory', async () => { await contextState.update(tasksKey, []); taskTree.refresh(); }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('localCliWorkers')) vscode.window.showInformationMessage('Local CLI Workers: reload the window to apply configuration changes.'); }));
}

async function runTask(resume?: AgentTask): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const prompt = resume?.prompt ?? await vscode.window.showInputBox({ prompt: 'Describe the task for a local CLI worker', placeHolder: 'Review this file and suggest improvements' });
  if (!prompt) return;
  const profiles = readConfig().profiles;
  const worker = resume ? { value: resume.worker } : await vscode.window.showQuickPick([
    { label: 'Auto', description: 'Usage-aware routing', value: 'auto' as WorkerSelection },
    ...(['codex', 'claude'] as WorkerId[]).map(id => ({ label: profiles[id].label, description: profiles[id].modelLabel, value: id as WorkerSelection }))
  ], { placeHolder: 'Select worker (manual override)' });
  if (!worker) return;
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? editor?.document.uri.fsPath ?? process.cwd();
  const context = editor ? { file: editor.document.uri.fsPath, selection: editor.document.getText(editor.selection), language: editor.document.languageId } : undefined;
  const risky = /\b(delete|remove|overwrite|install|deploy|push|force|sudo|chmod)\b/i.test(prompt);
  if (risky && !(await vscode.window.showWarningMessage('This task may modify files or run privileged commands.', { modal: true }, 'Approve'))) return;
  const task: AgentTask = resume ? { ...resume, status: 'queued', updatedAt: Date.now(), error: undefined, activity: [...resume.activity, 'Resumed'] } : { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, prompt, cwd, worker: worker.value as WorkerSelection, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), context, activity: [] };
  await saveTask(task);
  output.clear(); output.show(true); status.text = `$(sync~spin) ${worker.value}`;
  try {
    task.status = 'running'; task.updatedAt = Date.now(); task.activity.push(`Started ${worker.value}`); await saveTask(task);
    const contextualPrompt = context?.file ? `${prompt}\n\nWorkspace context:\n- Active file: ${context.file}\n- Language: ${context.language}\n- Selection:\n${context.selection || '(none)'}` : prompt;
    const result = await manager.run({ prompt: contextualPrompt, cwd, worker: worker.value, timeoutMs: readConfig().taskTimeoutMs, context }, chunk => { output.append(chunk.text); task.activity.push(chunk.text.slice(0, 160)); task.updatedAt = Date.now(); void saveTask(task); });
    task.status = result.exitCode === 0 ? 'completed' : 'failed'; task.result = result; task.updatedAt = Date.now(); task.activity.push(`Exited ${result.exitCode ?? 'unknown'}`); await saveTask(task);
    const history = contextState.get<Array<{ prompt: string; worker: string; at: number }>>(historyKey, []);
    await contextState.update(historyKey, [...history.slice(-49), { prompt, worker: result.worker, at: Date.now() }]);
    status.text = `$(hubot) ${result.worker}`;
    if ((result.attempts?.length ?? 0) > 1) {
      output.appendLine(`\n>> Done by ${result.worker} after trying ${result.attempts!.join(' then ')}.`);
    }
    if (result.exitCode !== 0) vscode.window.showErrorMessage(`${result.worker} exited with code ${result.exitCode}`);
  } catch (error) { task.status = /cancel/i.test(String(error)) ? 'cancelled' : 'failed'; task.error = String(error); task.updatedAt = Date.now(); task.activity.push(task.error); await saveTask(task); status.text = '$(hubot) Workers'; vscode.window.showErrorMessage(String(error)); }
}
const convKey = 'localCliWorkers.conversation';

/** A chat that belongs to the workspace, not to either provider: it survives one of them running dry. */
async function chat(): Promise<void> {
  const text = await vscode.window.showInputBox({
    prompt: 'Message', placeHolder: 'Ask anything; it continues on whichever worker has quota' });
  if (!text) return;
  const stored = contextState.get<Conversation>(convKey);
  const conv = stored ?? newConversation();
  const cfg = readConfig();
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  output.show(true);
  output.appendLine(`\nYou: ${text}`);
  status.text = '$(sync~spin) chat';
  try {
    const reply = await say(manager, conv, text, { cwd, timeoutMs: cfg.taskTimeoutMs });
    const models = cfg.modelIds as Record<string, string | undefined>;
    const who = `${reply.worker}${models[reply.worker] ? ` (${models[reply.worker]})` : ''}`;
    if (reply.replayed) output.appendLine(`>> ${who} picked the conversation up and was given the transcript.`);
    output.appendLine(`${who}: ${reply.text}`);
    if (reply.tokens) output.appendLine(`   [${reply.tokens.input ?? '?'} in / ${reply.tokens.output ?? '?'} out]`);
    await contextState.update(convKey, conv);
    status.text = `$(comment-discussion) ${reply.worker}`;
  } catch (error) {
    status.text = '$(hubot) Workers';
    output.appendLine(`!! ${String(error)}`);
    vscode.window.showErrorMessage(String(error));
  }
}

async function newChat(): Promise<void> {
  await contextState.update(convKey, undefined);
  output.appendLine('\n-- new conversation --');
  vscode.window.showInformationMessage('Local CLI Workers: started a new conversation.');
}

async function saveTask(task: AgentTask): Promise<void> {
  const tasks = contextState.get<AgentTask[]>(tasksKey, []).filter(t => t.id !== task.id);
  await contextState.update(tasksKey, [...tasks, task].slice(-100));
  taskTree?.refresh();
}
async function showWorkers(): Promise<void> {
  const profiles = readConfig().profiles;
  const items = manager.snapshots().map(s => `${profiles[s.worker].label} (${profiles[s.worker].modelLabel}): ${s.running ? 'running' : 'idle'} · completed ${s.completed} · failures ${s.failures} · usage ${s.usage.state}${s.usageThresholdReached ? ' (threshold)' : ''}`);
  await vscode.window.showQuickPick(items, { placeHolder: 'Worker usage' });
}
async function openWorkerTerminal(): Promise<void> {
  const worker = await vscode.window.showQuickPick(['codex', 'claude'], { placeHolder: 'Open visible terminal for worker' });
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
