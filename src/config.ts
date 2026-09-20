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
  codexSandbox: string;
  limitedCooldownMs: number;
  modelIds: Partial<Record<WorkerId, string>>;
  profiles: Record<WorkerId, WorkerProfile>;
}

export function readConfig(): WorkerConfig {
  const c = vscode.workspace.getConfiguration('localCliWorkers');
  return {
    managerModel: c.get<string>('managerModel', 'local manager'),
    defaultWorker: c.get<WorkerSelection>('defaultWorker', 'auto'),
    commands: {
      codex: c.get<string>('codexCommand', 'codex'),
      claude: c.get<string>('claudeCommand', 'claude')
    },
    codexSandbox: c.get<string>('codexSandbox', 'read-only'),
    modelIds: {
      codex: c.get<string>('codexModelId', '') || undefined,
      claude: c.get<string>('claudeModelId', 'sonnet') || undefined
    },
    limitedCooldownMs: c.get<number>('limitedCooldownMs', 1800000),
    maxConcurrentTasks: c.get<number>('maxConcurrentTasks', 1),
    taskTimeoutMs: c.get<number>('taskTimeoutMs', 600000),
    showWorkerTerminals: c.get<boolean>('showWorkerTerminals', true),
    failureThreshold: c.get<number>('failureThreshold', 3),
    usageThreshold: c.get<number>('usageThreshold', 0),
    profiles: {
      codex: { id: 'codex', label: 'Codex', modelLabel: c.get<string>('codexModel', 'local Codex CLI'), command: c.get<string>('codexCommand', 'codex'), enabled: true },
      claude: { id: 'claude', label: 'Claude Code', modelLabel: c.get<string>('claudeModel', 'local Claude Code CLI'), command: c.get<string>('claudeCommand', 'claude'), enabled: true }
    }
  };
}
