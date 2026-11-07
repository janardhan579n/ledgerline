import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Backend } from '../data/backend';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-sign-in',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="signin">
      <div class="signin-card card">
        <div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="7"/><path d="M10 21l5-6 4 3 4-7"/></svg><span>Ledgerline</span></div>
        <h1>Your money, in every currency you use</h1>
        <p class="muted">Track salary, spending, budgets and savings goals across currencies, with reports and practical next steps for what's left over.</p>
        <button class="btn primary signin-btn" (click)="go()" [disabled]="busy()">
          @if (backend.mode === 'demo') {Try the demo} @else {<svg viewBox="0 0 24 24" class="g" aria-hidden="true"><path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#fff" opacity=".85" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.9 5.9 0 0 1-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#fff" opacity=".7" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z"/><path fill="#fff" opacity=".55" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6A5.9 5.9 0 0 1 12 5.9z"/></svg>Continue with Google}
        </button>
        @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
        <ul class="signin-points">
          <li><app-icon name="lock" /><span>Only your Google sign-in can read or change your records.</span></li>
          <li><app-icon name="flow" /><span>Enter amounts in any currency; totals convert to the one you choose.</span></li>
          <li><app-icon name="check" /><span>Works offline on your phone and syncs when you're back online.</span></li>
        </ul>
      </div>
    </main>`,
})
export default class SignIn {
  protected readonly backend = inject(Backend);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected async go() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.backend.signIn();
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      this.error.set(code === 'auth/unauthorized-domain'
        ? "This web address isn't allowed to sign in yet. Add it under Firebase Authentication → Settings → Authorized domains."
        : code === 'auth/network-request-failed' ? 'No connection. Check your internet and try again.' : "Sign-in didn't complete. Please try again.");
    } finally {
      this.busy.set(false);
    }
  }
}
