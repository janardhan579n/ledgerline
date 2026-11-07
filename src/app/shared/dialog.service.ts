import { Injectable, Type, signal } from '@angular/core';

interface OpenDialog {
  component: Type<unknown>;
  inputs: Record<string, unknown>;
  resolve: (v: unknown) => void;
}

/** One dialog at a time; the host in App renders `current`. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly current = signal<OpenDialog | null>(null);
  private lastFocus: HTMLElement | null = null;

  open<R = unknown>(component: Type<unknown>, inputs: Record<string, unknown> = {}): Promise<R | undefined> {
    this.current()?.resolve(undefined);
    this.lastFocus = document.activeElement as HTMLElement | null;
    return new Promise((resolve) => this.current.set({ component, inputs, resolve: resolve as (v: unknown) => void }));
  }

  close(result?: unknown) {
    const c = this.current();
    if (!c) return;
    this.current.set(null);
    c.resolve(result);
    queueMicrotask(() => this.lastFocus?.focus?.());
  }
}
