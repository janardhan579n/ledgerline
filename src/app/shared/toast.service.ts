import { Injectable, signal } from '@angular/core';

export interface Toast { message: string; kind: 'info' | 'error'; id: number }

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly current = signal<Toast | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  show(message: string, kind: 'info' | 'error' = 'info') {
    clearTimeout(this.timer);
    this.current.set({ message, kind, id: Date.now() });
    this.timer = setTimeout(() => this.current.set(null), kind === 'error' ? 6000 : 2600);
  }
}
