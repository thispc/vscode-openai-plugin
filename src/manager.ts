import { TaskRequest, TaskResult, WorkerAdapter, WorkerId, UsageSnapshot, TaskHandle, StreamChunk, WorkerSelection } from './models';

export class WorkerManager {
  private readonly usage = new Map<WorkerId, UsageSnapshot>();
  private active = new Map<number, { worker: WorkerId; handle: TaskHandle }>();
  private nextId = 1;
  constructor(private readonly adapters: Record<WorkerId, WorkerAdapter>, private readonly maxConcurrent = 1, private readonly failureThreshold = 3, private readonly usageThreshold = 20) {
    for (const id of Object.keys(adapters) as WorkerId[]) this.usage.set(id, { worker: id, running: 0, completed: 0, failures: 0, usage: { state: 'unknown' }, usageThresholdReached: false, available: true });
  }
  snapshots(): UsageSnapshot[] { return [...this.usage.values()].map(s => ({ ...s })); }
  cancelActive(): void { for (const task of this.active.values()) task.handle.cancel(); this.active.clear(); }
  activeTasks(): number { return this.active.size; }
  private choose(selection: WorkerSelection = 'auto', excluded: WorkerId[] = []): WorkerId {
    if (selection !== 'auto') return selection;
    const candidates = [...this.usage.values()].filter(s =>
      s.available &&
      s.failures < this.failureThreshold &&
      !s.usageThresholdReached &&
      !excluded.includes(s.worker)
    );
    if (!candidates.length) throw new Error('No healthy workers are available.');
    return candidates.sort((a, b) => (a.running - b.running) || (a.failures - b.failures) || ((a.lastUsed ?? 0) - (b.lastUsed ?? 0)))[0].worker;
  }
  run(request: TaskRequest, onChunk: (chunk: StreamChunk) => void): Promise<TaskResult> {
    if (this.active.size >= this.maxConcurrent) throw new Error(`Concurrency limit reached (${this.maxConcurrent}).`);
    const attempts: WorkerId[] = [];
    const candidates = request.worker && request.worker !== 'auto' ? [request.worker] : [...this.usage.keys()];
    const attempt = (index: number): Promise<TaskResult> => {
      const worker = request.worker && request.worker !== 'auto' ? request.worker : this.choose('auto', attempts);
      attempts.push(worker);
      const stats = this.usage.get(worker)!; stats.running++;
      const taskId = this.nextId++;
      const handle = this.adapters[worker].run({ ...request, worker }, onChunk);
      this.active.set(taskId, { worker, handle });
      return handle.promise.then(result => {
        stats.running--; stats.completed++; stats.lastUsed = Date.now();
        stats.usage = { state: 'estimated', completedEstimate: stats.completed };
        stats.usageThresholdReached = stats.completed >= this.usageThreshold;
        if (result.exitCode !== 0) { stats.failures++; stats.available = stats.failures < this.failureThreshold; }
        this.active.delete(taskId);
        if (result.exitCode !== 0 && index + 1 < candidates.length) return attempt(index + 1);
        return { ...result, attempts };
      }, error => {
        stats.running--; stats.failures++; stats.available = stats.failures < this.failureThreshold; this.active.delete(taskId);
        if (index + 1 < candidates.length) return attempt(index + 1);
        throw error;
      });
    };
    return attempt(0);
  }
}
