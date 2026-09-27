export class GameLoop {
  private lastTime = 0;
  private animationFrame = 0;
  private running = false;

  constructor(private readonly update: (dt: number) => void) {}

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastTime = performance.now();
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  public stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
  }

  private readonly tick = (time: number): void => {
    if (!this.running) {
      return;
    }

    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.update(dt);
    this.animationFrame = requestAnimationFrame(this.tick);
  };
}
