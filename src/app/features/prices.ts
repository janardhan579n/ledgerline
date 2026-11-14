import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { dateLabel } from '../core/dates';
import { NOTIFICATIONS_ENABLED, PriceAlert, RuleState, targetReached, alertSubject, alertValue, describeRule, formatPrice, newTopic } from '../core/price-alerts';
import { DialogService } from '../shared/dialog.service';
import { Icon } from '../shared/icon';
import { PricesService } from '../shared/prices.service';
import { PushService } from '../shared/push.service';
import { ToastService } from '../shared/toast.service';
import { LedgerStore } from '../state/ledger.store';

const HOURS = Array.from({ length: 24 }, (_, h) => ({ h, label: `${h % 12 || 12}:00 ${h < 12 ? 'am' : 'pm'}` }));
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

@Component({
  selector: 'app-prices',
  imports: [Icon, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card-h page-h">
      <p class="muted">{{ notify ? 'Follow gold, silver and exchange rates, and get a notification every day or when a price reaches the level you set. Prices are checked every hour.' : 'Gold, silver and exchange rates, fetched when you ask. Add the prices you care about to your list and set a target to see when it is reached.' }}</p>
      <button class="btn primary" (click)="refresh()" [disabled]="prices.loading()"><app-icon name="refresh" />{{ prices.loading() ? 'Getting prices…' : 'Get latest prices' }}</button>
    </section>

    @if (reached().length) {
      <p class="banner good-banner" role="status"><app-icon name="check" /><span><b>Target reached:</b> {{ reached().join(' · ') }}</span></p>
    }

    <section class="tiles four" aria-label="Prices now">
      @for (t of tiles(); track t.label) {
        <button type="button" class="tile price-tile" (click)="openForm(t.preset)" [attr.aria-label]="'Watch ' + t.label">
          <span class="tile-k">{{ t.label }}</span>
          <span class="tile-v">{{ t.value ?? '—' }}</span>
          <span class="delta flat"><app-icon [name]="notify ? 'bell' : 'plus'" />{{ notify ? 'Set an alert' : 'Watch / set a target' }}</span>
        </button>
      }
    </section>
    <p class="note small muted">
      @if (prices.loading()) {Loading prices…} @else if (prices.quotes()) {International spot prices, updated {{ asOf() }}.}
      Shop and bank prices add a premium (and in India, duty and GST).
      @if (prices.error()) {<span class="warn-text"> {{ prices.error() }}</span>}
    </p>

    <section class="card">
      <div class="card-h"><h3>{{ notify ? 'Your alerts' : 'Your list' }}</h3><button class="btn sm" (click)="openForm()"><app-icon name="plus" />{{ notify ? 'New alert' : 'Add a price' }}</button></div>
      @if (rows().length) {
        <ul class="alert-list">
          @for (r of rows(); track r.a.id) {
            <li [class.paused]="!r.a.active">
              @if (notify) {<label class="switch" [attr.aria-label]="(r.a.active ? 'Pause ' : 'Turn on ') + r.text"><input type="checkbox" [checked]="r.a.active" (change)="toggle(r.a)"><span></span></label>}
              <div class="al-main"><b>{{ notify ? r.text : r.name }}</b><small class="muted">{{ notify ? r.status : r.target }}@if (notify && r.now) { · now {{ r.now }}}</small></div>
              @if (!notify) {
                @if (r.hit) {<span class="pill good"><app-icon name="check" />Target reached</span>}
                <b class="al-price">{{ r.now || '—' }}</b>
              }
              @if (notify && r.done) {<button class="btn sm" (click)="rearm(r.a)">Turn on again</button>}
              <button class="btn sm ghost icon-only" (click)="openForm({}, r.a)" [attr.aria-label]="'Edit ' + r.text"><app-icon name="edit" /></button>
            </li>
          }
        </ul>
      } @else {
        <p class="empty-sm">@if (notify) {No alerts yet. Try "Gold 24K per gram in {{ primary() }}: daily update", or "1 {{ primary() }} in {{ other() }} goes above …".} @else {Nothing on your list yet. Tap a price above, or add one such as "1 {{ primary() }} in {{ other() }}" with a target.}</p>
      }
    </section>

    @if (notify) {
    <section class="card">
      <div class="card-h"><h3>Notifications</h3></div>
      @if (!settings().ntfy.on && !settings().push.on && rows().length) {<p class="banner warning small"><app-icon name="alert" />Turn on at least one way to be notified below, or your alerts can't reach you.</p>}

      <div class="notify-block">
        <div class="nb-head"><label class="switch"><input type="checkbox" [checked]="settings().ntfy.on" (change)="setNtfy(!settings().ntfy.on)"><span></span></label>
          <div><b>Phone push with the ntfy app</b><small class="muted">Free, no account. Works on Android and iPhone.</small></div></div>
        @if (settings().ntfy.on) {
          <ol class="nb-steps small">
            <li>Install <b>ntfy</b>: <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Google Play</a> or <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">App Store</a>.</li>
            <li>In ntfy, tap <b>+</b> and subscribe to this topic (server ntfy.sh):
              <div class="topic"><code>{{ settings().ntfy.topic }}</code><button class="btn sm" (click)="copyTopic()">Copy</button></div>
              <span class="muted">Keep it private: anyone who knows the topic can read these alerts.</span></li>
            <li><button class="btn sm" (click)="testNtfy()" [disabled]="busy()">Send a test</button> and check it arrives.</li>
          </ol>
        }
      </div>

      <div class="notify-block">
        <div class="nb-head"><label class="switch"><input type="checkbox" [checked]="push.status() === 'on'" (change)="push.status() === 'on' ? push.disable() : push.enable()" [disabled]="!canPush()"><span></span></label>
          <div><b>Notifications on this device</b><small class="muted">From Ledgerline itself, in this browser.</small></div></div>
        <p class="small muted nb-note">
          @switch (push.status()) {
            @case ('on') {On for this device. Turn it on in each browser or phone where you want alerts. <button class="link-btn" (click)="push.test()">Show a test</button>}
            @case ('off') {@if (push.needsHomeScreen) {On iPhone/iPad, first add Ledgerline to the Home Screen (Share → Add to Home Screen), then open it from there.} @else {Turn on to get alerts here too.}}
            @case ('blocked') {Notifications are blocked for this site. Allow them in the browser's site settings, then try again.}
            @case ('unsupported') {This browser can't receive web push.@if (push.needsHomeScreen) { On iPhone/iPad, add Ledgerline to the Home Screen first.}}
            @case ('not-configured') {Not set up yet: add the Web Push key to the app (see README → Price alerts).}
            @case ('demo') {Not available in demo mode.}
            @default {Checking…}
          }
        </p>
        @if (push.error()) {<p class="small warn-text">{{ push.error() }}</p>}
      </div>

      <div class="field-row nb-time">
        <div class="field"><label for="pa-hour">Daily update time</label>
          <select id="pa-hour" [ngModel]="settings().dailyHour" (ngModelChange)="setHour(+$event)">@for (h of hours; track h.h) {<option [value]="h.h">{{ h.label }}</option>}</select></div>
        <div class="field"><label for="pa-tz">Time zone</label>
          <select id="pa-tz" [ngModel]="settings().timezone" (ngModelChange)="setTz($event)">@for (z of zones(); track z) {<option [value]="z">{{ z }}</option>}</select></div>
      </div>

      <p class="small" [class.warn-text]="schedulerProblem()">
        <app-icon [name]="schedulerProblem() ? 'alert' : 'clock'" />
        @if (lastRun(); as r) {Last checked by the scheduler {{ r }}.} @else {The scheduler hasn't checked your alerts yet.}
        @if (schedulerProblem()) { If this stays, the hourly GitHub job may not be set up (README → Price alerts).}
        @if (state()?.lastError) {<br><span class="warn-text">Last problem: {{ state()!.lastError }}</span>}
      </p>
    </section>
    }
  `,
})
export default class Prices implements OnInit {
  protected readonly store = inject(LedgerStore);
  protected readonly prices = inject(PricesService);
  protected readonly push = inject(PushService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  protected readonly hours = HOURS;
  protected readonly notify = NOTIFICATIONS_ENABLED;
  protected readonly busy = signal(false);
  protected readonly settings = this.store.alertsView;
  protected readonly state = this.store.alertState;
  protected readonly primary = this.store.primary;
  protected readonly other = computed(() => this.store.settingsView().currencies.find((c) => c !== this.primary()) ?? (this.primary() === 'INR' ? 'MYR' : 'INR'));
  protected readonly canPush = computed(() => ['on', 'off'].includes(this.push.status()));
  protected readonly zones = computed(() => [...new Set([this.settings().timezone, deviceTz(), 'Asia/Kuala_Lumpur', 'Asia/Kolkata', 'Asia/Singapore', 'UTC'])]);

  protected readonly tiles = computed(() => {
    const q = this.prices.quotes(), P = this.primary(), O = this.other();
    const items: { label: string; preset: Partial<PriceAlert> }[] = [
      { label: `Gold 24K per gram (${P})`, preset: { asset: 'gold', purity: 0.999, unit: 'g', currency: P } },
      O === 'INR' || P === 'INR'
        ? { label: 'Gold 22K per 10 g (INR)', preset: { asset: 'gold', purity: 0.916, unit: '10g', currency: 'INR' } }
        : { label: `Gold 22K per gram (${P})`, preset: { asset: 'gold', purity: 0.916, unit: 'g', currency: P } },
      { label: `Silver per gram (${P})`, preset: { asset: 'silver', unit: 'g', currency: P } },
      { label: `1 ${P} in ${O}`, preset: { asset: 'fx', base: P, currency: O } },
    ];
    return items.map((t) => {
      const v = q ? alertValue(t.preset as PriceAlert, q) : null;
      return { ...t, value: v == null ? null : formatPrice(v, t.preset as PriceAlert) };
    });
  });
  protected readonly asOf = computed(() => {
    const d = this.prices.quotes()?.asOf;
    return d ? new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  });

  protected readonly rows = computed(() => {
    const q = this.prices.quotes();
    const st = this.state()?.rules ?? {};
    const hour = HOURS[this.settings().dailyHour]?.label ?? '';
    return this.settings().alerts.map((a) => {
      const s: RuleState | undefined = st[a.id]?.rev === a.rev ? st[a.id] : undefined;
      const v = q ? alertValue(a, q) : null;
      const sent = s?.firedAt ? `last sent ${dateLabel(s.firedAt.slice(0, 10), true)}${s.firedValue != null && a.kind !== 'daily' ? ' at ' + formatPrice(s.firedValue, a) : ''}` : '';
      const status = !a.active ? 'Paused'
        : a.kind === 'daily' ? `Every day at ${hour}${sent ? ' · ' + sent : ''}`
        : s?.done ? `Sent ${dateLabel(s.firedAt!.slice(0, 10), true)}${s.firedValue != null ? ' at ' + formatPrice(s.firedValue, a) : ''}, now stopped`
        : `Watching${a.repeat === 'every' ? ', every time' : ', once'}${sent ? ' · ' + sent : ''}`;
      const target = a.kind === 'above' ? `Target: ${formatPrice(a.value ?? 0, a)} or above` : a.kind === 'below' ? `Target: ${formatPrice(a.value ?? 0, a)} or below` : 'No target';
      return { a, text: describeRule(a), name: alertSubject(a), target, hit: targetReached(a, v), status, now: v == null ? '' : formatPrice(v, a), done: !!s?.done && a.active };
    });
  });
  /** Targets met at the latest prices, shown at the top after a refresh. */
  protected readonly reached = computed(() => (this.notify ? [] : this.rows().filter((r) => r.hit).map((r) => `${r.name} is ${r.now}`)));
  protected readonly lastRun = computed(() => {
    const r = this.state()?.lastRun;
    if (!r) return '';
    const mins = Math.round((Date.now() - new Date(r).getTime()) / 60000);
    return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `on ${dateLabel(r.slice(0, 10), true)}`;
  });
  protected readonly schedulerProblem = computed(() => {
    if (!this.settings().alerts.length) return false;
    const r = this.state()?.lastRun;
    return !r ? Date.now() - new Date(this.settings().updatedAt ?? Date.now()).getTime() > 2.5 * 3600_000 : Date.now() - new Date(r).getTime() > 3 * 3600_000;
  });

  ngOnInit() {
    void this.prices.load();
    if (this.notify) this.push.check();
  }
  protected async refresh() {
    await this.prices.load(true);
    if (!this.prices.quotes()) return;
    const n = this.reached().length;
    this.toast.show(this.prices.error() ? 'Showing the last known prices.' : n ? `Prices updated. ${n} target${n === 1 ? '' : 's'} reached.` : 'Prices updated.');
  }

  protected openForm(preset: Partial<PriceAlert> = {}, alert: PriceAlert | null = null) {
    return import('../forms/price-alert-form').then((m) => this.dialog.open(m.PriceAlertForm, { alert, preset }));
  }
  protected toggle(a: PriceAlert) {
    void this.store.saveAlerts((s) => { const x = s.alerts.find((y) => y.id === a.id); if (x) x.active = !x.active; });
  }
  protected rearm(a: PriceAlert) {
    void this.store.saveAlerts((s) => { const x = s.alerts.find((y) => y.id === a.id); if (x) x.rev = new Date().toISOString(); });
    this.toast.show('Turned on again.');
  }
  protected setNtfy(on: boolean) {
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    void this.store.saveAlerts((s) => (s.ntfy = { on, topic: s.ntfy.topic || newTopic(rnd) }));
  }
  protected async copyTopic() {
    try { await navigator.clipboard.writeText(this.settings().ntfy.topic); this.toast.show('Topic copied.'); }
    catch { this.toast.show('Select the topic and copy it.'); }
  }
  protected async testNtfy() {
    this.busy.set(true);
    try {
      const r = await fetch('https://ntfy.sh/', {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ topic: this.settings().ntfy.topic, title: 'Ledgerline test', message: 'Price alerts will arrive here.', tags: ['coin'], click: location.origin + '/prices' }),
      });
      this.toast.show(r.ok ? 'Test sent. Check the ntfy app.' : `ntfy answered ${r.status}.`, r.ok ? 'info' : 'error');
    } catch {
      this.toast.show("Couldn't reach ntfy.sh. Check your connection.", 'error');
    } finally {
      this.busy.set(false);
    }
  }
  protected setHour(h: number) { void this.store.saveAlerts((s) => (s.dailyHour = h)); }
  protected setTz(z: string) { void this.store.saveAlerts((s) => (s.timezone = z)); }
  protected readonly subject = alertSubject;
}
