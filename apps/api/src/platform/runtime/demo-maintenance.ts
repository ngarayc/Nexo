import { Injectable } from '@nestjs/common';

export class DemoMaintenanceBusy extends Error {}

// Una API por despliegue. Las peticiones conservan su generación incluso si
// cierran el socket; una admisión anterior nunca cruza una limpieza.
@Injectable()
export class DemoMaintenance {
  private clearing = false;
  private writers = 0;
  private epoch = 0;

  get generation(): number {
    return this.epoch;
  }
  get active(): boolean {
    return this.clearing;
  }

  async ingestion<T>(generation: number, operation: () => Promise<T>): Promise<T> {
    if (this.clearing || generation !== this.epoch) throw new DemoMaintenanceBusy();
    this.writers++;
    try {
      return await operation();
    } finally {
      this.writers--;
    }
  }

  begin(): () => void {
    if (this.clearing || this.writers) throw new DemoMaintenanceBusy();
    this.clearing = true;
    this.epoch++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.clearing = false;
    };
  }
}
