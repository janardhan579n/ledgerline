import { Injectable, signal } from '@angular/core';
import { AppUser, Backend, DocRef, SubscribeHandlers } from './backend';

/** In-memory backend used before Firebase is configured. Nothing leaves the browser tab. */
@Injectable()
export class DemoBackend extends Backend {
  readonly mode = 'demo' as const;
  readonly user = signal<AppUser | null | undefined>(null);
  private readonly docs = new Map<string, object>();
  private listeners = new Set<() => void>();

  async signIn(): Promise<void> {
    this.user.set({ uid: 'demo', name: 'Demo user', email: 'demo@example.com' });
  }

  async signOut(): Promise<void> {
    this.user.set(null);
  }

  subscribe(uid: string, h: SubscribeHandlers): () => void {
    const fire = () => {
      const months: Record<string, never[]> = {};
      const get = (id: string) => (this.docs.get(`${uid}/ledger/${id}`) as never) ?? null;
      for (const [k, v] of this.docs) {
        const m = k.match(new RegExp(`^${uid}/months/(.+)$`));
        if (m) months[m[1]] = (v as { items: never[] }).items;
      }
      h.next({ settings: get('settings'), plan: get('plan'), market: get('market'), months, fromServer: true });
    };
    this.listeners.add(fire);
    queueMicrotask(fire);
    return () => this.listeners.delete(fire);
  }

  async write(uid: string, ref: DocRef, data: object): Promise<void> {
    this.docs.set(this.key(uid, ref), structuredClone(data));
    this.notify();
  }

  async remove(uid: string, ref: DocRef): Promise<void> {
    this.docs.delete(this.key(uid, ref));
    this.notify();
  }

  private key(uid: string, ref: DocRef) {
    return `${uid}/${ref.kind === 'ledger' ? 'ledger' : 'months'}/${ref.id}`;
  }

  private notify() {
    queueMicrotask(() => this.listeners.forEach((l) => l()));
  }
}
