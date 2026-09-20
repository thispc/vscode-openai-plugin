import * as vscode from 'vscode';
import { WorkerId, WorkerSelection, WorkerProfile } from './models';

export interface WorkerConfig {
  managerModel: string;
  defaultWorker: WorkerSelection;
  commands: Record<WorkerId, string>;
  maxConcurrentTasks: number;
  taskTimeoutMs: number;
  showWorkerTerminals: boolean;
  failureThreshold: number;
  usageThreshold: number;
  profiles: Record<WorkerId, WorkerProfile>;
}

export function readConfig(): WorkerConfig {
  const c = vscode.workspace.getConfiguration('localCliWorkers');
  return {
    managerModel: c.get<string>('managerModel', 'local manager'),
    defaultWorker: c.get<WorkerSelection>('defaultWorker', 'auto'),
    commands: {
      codex: c.get<string>('codexCommand', 'codex'),
      claude: c.get<string>('claudeCommand', 'claude'),
      gemini: c.get<string>('geminiCommand', 'gemini')
    },
    maxConcurrentTasks: c.get<number>('maxConcurrentTasks', 1),
    taskTimeoutMs: c.get<number>('taskTimeoutMs', 600000),
    showWorkerTerminals: c.get<boolean>('showWorkerTerminals', true),
    failureThreshold: c.get<number>('failureThreshold', 3),
    usageThreshold: c.get<number>('usageThreshold', 20),
    profiles: {
      codex: { id: 'codex', label: 'Codex', modelLabel: c.get<string>('codexModel', 'local Codex CLI'), command: c.get<string>('codexCommand', 'codex'), enabled: true },
      claude: { id: 'claude', label: 'Claude Code', modelLabel: c.get<string>('claudeModel', 'local Claude Code CLI'), command: c.get<string>('claudeCommand', 'claude'), enabled: true },
      gemini: { id: 'gemini', label: 'Gemini CLI', modelLabel: c.get<string>('geminiModel', 'local Gemini CLI'), command: c.get<string>('geminiCommand', 'gemini'), enabled: true }
    }
  };
}
