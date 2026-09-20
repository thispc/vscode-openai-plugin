export type WorkerId = 'codex' | 'claude';
export type WorkerSelection = WorkerId | 'auto';
export type UsageConfidence = 'known' | 'estimated' | 'unknown';

export interface WorkerProfile {
  id: WorkerId;
  label: string;
  modelLabel: string;
  command: string;
  enabled: boolean;
}

export interface TaskRequest {
  prompt: string;
  cwd: string;
  worker?: WorkerSelection;
  timeoutMs?: number;
  context?: { file?: string; selection?: string; language?: string };
}

export interface StreamChunk {
  text: string;
  stream: 'stdout' | 'stderr';
}

export interface TaskResult {
  worker: WorkerId;
  exitCode: number | null;
  output: string;
  durationMs: number;
  attempts?: WorkerId[];
  /** The subscription's window is spent. Different from a failed task: this one comes back on its own. */
  rateLimited?: boolean;
  /** When the window is expected to reset, when the CLI said so. */
  resetAt?: number;
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface AgentTask {
  id: string;
  prompt: string;
  cwd: string;
  worker: WorkerSelection;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  result?: TaskResult;
  error?: string;
  context?: TaskRequest['context'];
  activity: string[];
}

export interface UsageSnapshot {
  worker: WorkerId;
  running: number;
  completed: number;
  failures: number;
  lastUsed?: number;
  usage: { state: UsageConfidence; completedEstimate?: number };
  usageThresholdReached: boolean;
  available: boolean;
  /** Set when the CLI itself reported the window spent; the worker is skipped until it passes. */
  limitedUntil?: number;
}

export interface WorkerAdapter {
  readonly id: WorkerId;
  run(request: TaskRequest, onChunk: (chunk: StreamChunk) => void): TaskHandle;
  checkAuth(cwd: string): Promise<AuthStatus>;
}

export interface AuthStatus { authenticated: boolean; detail: string; }
export interface TaskHandle {
  readonly promise: Promise<TaskResult>;
  cancel(): void;
}
