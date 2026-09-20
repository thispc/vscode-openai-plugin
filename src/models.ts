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
  /** Continue this provider-side session instead of starting a new one. */
  resumeId?: string;
  worker?: WorkerSelection;
  timeoutMs?: number;
  context?: { file?: string; selection?: string; language?: string };
}

export interface StreamChunk {
  text: string;
  stream: 'stdout' | 'stderr';
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  worker?: WorkerId;
  at: number;
}

/** A conversation that survives a provider running out: the turns are ours, the session ids are theirs. */
export interface Conversation {
  id: string;
  turns: Turn[];
  sessions: Partial<Record<WorkerId, string>>;
  createdAt: number;
  updatedAt: number;
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
  /** The provider's own session/thread id, so the next turn on this worker resumes instead of replaying. */
  sessionId?: string;
  /** Tokens this turn cost, when the CLI reported them. */
  tokens?: { input?: number; output?: number };
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
