/**
 * Messages typed while a reply is in flight.
 *
 * One turn runs at a time and the rest wait in the order they were typed, so a second message never races the
 * first or gets dropped. `onChange` reports what is still waiting, which is what the panel draws; the message
 * being answered is not "waiting" and is not shown as queued.
 */
export class TurnQueue {
  private readonly items: string[] = [];
  private running = false;
  private stopped = false;

  constructor(private readonly run: (text: string) => Promise<void>,
              private readonly onChange: (waiting: string[]) => void = () => {},
              private readonly onError: (e: unknown, text: string) => void = () => {},
              private readonly onIdle: () => void = () => {}) {}

  get busy(): boolean { return this.running; }
  get waiting(): string[] { return this.items.slice(this.running ? 1 : 0); }

  push(text: string): void {
    this.items.push(text);
    this.onChange(this.waiting);
    if (!this.running) void this.drain();
  }

  /** Drop everything not yet started. The turn in flight is cancelled by its own worker. */
  clear(): void {
    this.stopped = true;
    this.items.splice(this.running ? 1 : 0);
    this.onChange(this.waiting);
  }

  private async drain(): Promise<void> {
    this.running = true;
    this.stopped = false;
    while (this.items.length) {
      const text = this.items[0];
      try {
        await this.run(text);
      } catch (e) {
        this.onError(e, text);
      }
      this.items.shift();
      this.onChange(this.waiting);
      if (this.stopped) { this.items.length = 0; this.onChange([]); break; }
    }
    this.running = false;
    this.onIdle();
  }
}
