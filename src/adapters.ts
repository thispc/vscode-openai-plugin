import { spawn, ChildProcess } from 'node:child_process';
import { WorkerAdapter, WorkerId, TaskRequest, TaskHandle, TaskResult, StreamChunk, AuthStatus } from './models';

export class LocalCliAdapter implements WorkerAdapter {
  constructor(public readonly id: WorkerId, private readonly command: string) {}

  run(request: TaskRequest, onChunk: (chunk: StreamChunk) => void): TaskHandle {
    const started = Date.now();
    let child: ChildProcess | undefined;
    let settled = false;
    let rejectTask: ((reason?: unknown) => void) | undefined;
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<TaskResult>((resolve, reject) => {
      rejectTask = reject;
      try {
        // Prompt is passed as an argument, never through a shell, to avoid injection.
        child = spawn(this.command, this.argumentsFor(request.prompt), {
          cwd: request.cwd, shell: false, env: { ...process.env }
        });
      } catch (error) {
        reject(new Error(`Unable to start ${this.id}: ${String(error)}`)); return;
      }
      const output: string[] = [];
      const collect = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
        const text = data.toString();
        output.push(text); onChunk({ text, stream });
      };
      child.stdout?.on('data', collect('stdout'));
      child.stderr?.on('data', collect('stderr'));
      child.once('error', error => { if (!settled) { settled = true; reject(new Error(`${this.id} process error: ${error.message}`)); } });
      child.once('close', code => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ worker: this.id, exitCode: code, output: output.join(''), durationMs: Date.now() - started });
      });
      if (request.timeoutMs) {
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          child?.kill('SIGTERM');
          reject(new Error(`${this.id} task timed out after ${request.timeoutMs}ms`));
        }, request.timeoutMs);
      }
    });
    return {
      promise,
      cancel: () => {
        if (child && !settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          child.kill('SIGTERM');
          rejectTask?.(new Error(`${this.id} task cancelled`));
        }
      }
    };
  }

  async checkAuth(cwd: string): Promise<AuthStatus> {
    return new Promise(resolve => {
      const probe = spawn(this.command, this.authArguments(), { cwd, shell: false, env: { ...process.env } });
      let stderr = '';
      probe.stderr?.on('data', d => { stderr += d.toString(); });
      probe.once('error', e => resolve({ authenticated: false, detail: `${this.id} unavailable: ${e.message}` }));
      probe.once('close', code => resolve({ authenticated: code === 0, detail: code === 0 ? `${this.id} is authenticated` : (stderr.trim() || `${this.id} auth check failed`) }));
    });
  }

  protected argumentsFor(prompt: string): string[] { return ['--prompt', prompt]; }
  protected authArguments(): string[] { return ['auth', 'status']; }
}

export class CodexAdapter extends LocalCliAdapter {
  constructor(command: string) { super('codex', command); }
  protected argumentsFor(prompt: string): string[] { return ['exec', '--', prompt]; }
  protected authArguments(): string[] { return ['login', 'status']; }
}
export class ClaudeAdapter extends LocalCliAdapter {
  constructor(command: string) { super('claude', command); }
  protected argumentsFor(prompt: string): string[] { return ['-p', prompt]; }
}
export class GeminiAdapter extends LocalCliAdapter {
  constructor(command: string) { super('gemini', command); }
  protected argumentsFor(prompt: string): string[] { return ['-p', prompt]; }
}

export function createAdapters(commands: Record<WorkerId, string>): Record<WorkerId, WorkerAdapter> {
  return { codex: new CodexAdapter(commands.codex), claude: new ClaudeAdapter(commands.claude), gemini: new GeminiAdapter(commands.gemini) };
}
