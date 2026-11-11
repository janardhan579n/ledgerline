import { describe, expect, it } from 'vitest';
import { ALERT_DEFAULTS, AlertSettings, PriceAlert, Quotes, TROY_OZ_G, alertSubject, alertValue, describeRule, evaluate, fxRate, localClock, newTopic, quotesFrom } from './price-alerts';

// Gold USD 4,000/oz, silver USD 50/oz, 1 USD = 4.2 MYR = 88 INR
const q = (goldOz = 4000, silverOz = 50, myr = 4.2, inr = 88): Quotes => ({ goldUsdG: goldOz / TROY_OZ_G, silverUsdG: silverOz / TROY_OZ_G, usd: { USD: 1, MYR: myr, INR: inr }, asOf: '' });
const alert = (over: Partial<PriceAlert>): PriceAlert => ({ id: 'a', asset: 'gold', currency: 'MYR', unit: 'g', purity: 0.999, kind: 'above', value: 540, repeat: 'once', active: true, rev: '1', ...over });
const settings = (alerts: PriceAlert[], over: Partial<AlertSettings> = {}): AlertSettings => ({ ...ALERT_DEFAULTS, alerts, timezone: 'Asia/Kuala_Lumpur', dailyHour: 9, ...over });
// 2026-11-11 10:07 in Kuala Lumpur
const at = (iso = '2026-11-11T02:07:00Z') => new Date(iso);

describe('prices', () => {
  it('works out metal prices in any currency, unit and purity', () => {
    expect(alertValue(alert({}), q())).toBeCloseTo((4000 / TROY_OZ_G) * 4.2, 6);
    expect(alertValue(alert({ currency: 'INR', unit: '10g', purity: 0.916 }), q())).toBeCloseTo((4000 / TROY_OZ_G) * 88 * 10 * (0.916 / 0.999), 4);
    expect(alertValue(alert({ asset: 'silver', unit: 'kg' }), q())).toBeCloseTo((50 / TROY_OZ_G) * 4.2 * 1000, 4);
    expect(alertValue(alert({ asset: 'fx', base: 'MYR', currency: 'INR' }), q())).toBeCloseTo(88 / 4.2, 8);
    expect(fxRate(q(), 'INR', 'MYR')).toBeCloseTo(4.2 / 88, 8);
    expect(alertValue(alert({ currency: 'XXX' }), q())).toBeNull();
  });
  it('names and describes alerts', () => {
    expect(alertSubject(alert({ purity: 0.916 }))).toBe('Gold 22K per gram in MYR');
    expect(alertSubject(alert({ asset: 'fx', base: 'MYR', currency: 'INR' }))).toBe('1 MYR in INR');
    expect(describeRule(alert({ kind: 'move', value: 2 }))).toContain('moves 2% or more');
  });
  it('reads the free price feeds', () => {
    const x = quotesFrom({ spot_usd_oz: 4000, silver_usd_oz: 50 }, { rates: { MYR: 4.2, INR: 88 } });
    expect(x.goldUsdG).toBeCloseTo(4000 / TROY_OZ_G, 8);
    expect(x.usd).toMatchObject({ MYR: 4.2, INR: 88, USD: 1 });
    expect(quotesFrom(null, null).goldUsdG).toBeNull();
  });
  it('knows the local hour in another time zone', () => {
    expect(localClock(at(), 'Asia/Kuala_Lumpur')).toEqual({ date: '2026-11-11', hour: 10 });
    expect(localClock(at(), 'Asia/Kolkata')).toEqual({ date: '2026-11-11', hour: 7 });
  });
  it('makes unguessable ntfy topics', () => {
    expect(newTopic()).toMatch(/^ledgerline-[a-z2-9]{20}$/);
    expect(newTopic()).not.toBe(newTopic());
  });
});

describe('above / below', () => {
  // Gold 24K ≈ RM 540.14/g at USD 4,000/oz
  it('fires once when the price crosses, then stops', () => {
    const s = settings([alert({ value: 545 })]);
    let r = evaluate(s, null, q(), at());
    expect(r.notices).toEqual([]);
    r = evaluate(s, r.state, q(4040), at());
    expect(r.notices.length).toBe(1);
    expect(r.notices[0].title).toContain('above');
    expect(r.state.rules['a']).toMatchObject({ done: true, armed: false });
    expect(evaluate(s, r.state, q(4100), at()).notices).toEqual([]);
  });
  it('fires again only after the price has gone back', () => {
    const s = settings([alert({ kind: 'below', value: 530, repeat: 'every' })]);
    let r = evaluate(s, null, q(3900), at());
    expect(r.notices.length).toBe(1);
    r = evaluate(s, r.state, q(3890), at());
    expect(r.notices).toEqual([]); // still below: no repeat
    r = evaluate(s, r.state, q(4000), at()); // back above → re-armed
    expect(r.notices).toEqual([]);
    r = evaluate(s, r.state, q(3900), at());
    expect(r.notices.length).toBe(1);
  });
  it('starts fresh when the alert is edited, and skips paused alerts', () => {
    const s = settings([alert({ value: 530 })]);
    const r = evaluate(s, null, q(), at());
    expect(r.state.rules['a'].done).toBe(true);
    expect(evaluate(settings([alert({ value: 530, rev: '2' })]), r.state, q(), at()).notices.length).toBe(1);
    expect(evaluate(settings([alert({ value: 530, active: false })]), null, q(), at()).notices).toEqual([]);
  });
});

describe('moves and daily updates', () => {
  it('notifies on a percentage move from the last notified price', () => {
    const s = settings([alert({ asset: 'fx', base: 'MYR', currency: 'INR', kind: 'move', value: 1, repeat: 'every' })]);
    let r = evaluate(s, null, q(), at());
    expect(r.notices).toEqual([]);
    r = evaluate(s, r.state, q(4000, 50, 4.2, 88.5), at()); // +0.57%
    expect(r.notices).toEqual([]);
    r = evaluate(s, r.state, q(4000, 50, 4.2, 89), at()); // +1.14%
    expect(r.notices[0].title).toContain('▲1.14%');
    expect(r.state.rules['a'].ref).toBeCloseTo(89 / 4.2, 8);
  });
  it('sends one daily summary after the chosen hour, once a day', () => {
    const s = settings([alert({ kind: 'daily' }), alert({ id: 'b', asset: 'fx', base: 'MYR', currency: 'INR', kind: 'daily' })], { dailyHour: 9 });
    expect(evaluate(s, null, q(), at('2026-11-11T00:07:00Z')).notices).toEqual([]); // 8:07 local
    let r = evaluate(s, null, q(), at()); // 10:07 local
    expect(r.notices.length).toBe(1);
    expect(r.notices[0].body.split('\n').length).toBe(2);
    expect(r.state.lastDaily).toBe('2026-11-11');
    expect(evaluate(s, r.state, q(), at('2026-11-11T05:07:00Z')).notices).toEqual([]);
    r = evaluate(s, r.state, q(4040), at('2026-11-12T01:07:00Z'));
    expect(r.notices[0].body).toContain('▲1.00% since yesterday');
  });
});
