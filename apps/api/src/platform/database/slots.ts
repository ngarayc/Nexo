export class DatabaseCapacityError extends Error {
  constructor() {
    super('Capacidad de acceso a base temporalmente ocupada.');
  }
}

interface Waiting {
  readonly grant: (release: () => void) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

// Limita también las operaciones que esperan, además de las conexiones del pool.
export class DatabaseSlots {
  private active = 0;
  private readonly waiting: Waiting[] = [];

  constructor(
    private readonly maximum: number,
    private readonly maximumWaiting: number,
    private readonly waitMilliseconds = 2000,
  ) {
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      !Number.isSafeInteger(maximumWaiting) ||
      maximumWaiting < 0 ||
      !Number.isSafeInteger(waitMilliseconds) ||
      waitMilliseconds < 1
    )
      throw new Error('Presupuesto de acceso a base inválido.');
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private acquire(): Promise<() => void> {
    if (this.active < this.maximum) {
      this.active += 1;
      return Promise.resolve(this.releaser());
    }
    if (this.waiting.length >= this.maximumWaiting)
      return Promise.reject(new DatabaseCapacityError());
    return new Promise((grant, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new DatabaseCapacityError());
      }, this.waitMilliseconds);
      const waiter = { grant, timer };
      this.waiting.push(waiter);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.grant(this.releaser());
      } else this.active -= 1;
    };
  }
}
