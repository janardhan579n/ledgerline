import { describe, expect, it } from 'vitest';
import { Debt } from './models';
import { addMonthsToDate, debtBalanceNow, emiFor, emisDueSince, loanStatus, nextDueDate, prepay, presentValue, resolveRate, schedule, scheduleByYear, solveRate } from './loans';

const loan = (over: Partial<Debt['emi']> = {}, apr = 9): Debt => ({
  id: 'l1', name: 'Home loan', currency: 'INR', apr, minPayment: 0, balance: 0,
  emi: { amount: 25_000, monthsLeft: 120, nextDate: '2026-12-05', day: 5, basis: 'rate', ...over },
});

describe('loan maths', () => {
  it('matches the standard EMI formula', () => {
    // 20 lakh at 9% for 20 years → about 17,995 a month (bank calculators agree)
    expect(emiFor(2_000_000, 9, 240)).toBeCloseTo(17_994.52, 1);
    expect(presentValue(emiFor(2_000_000, 9, 240), 240, 9)).toBeCloseTo(2_000_000, 2);
    expect(emiFor(12_000, 0, 12)).toBe(1000);
  });
  it('works the rate back out from principal, EMI and months', () => {
    expect(solveRate(2_000_000, 17_994.52, 240)).toBeCloseTo(9, 2);
    expect(solveRate(12_000, 1000, 12)).toBe(0);
    expect(solveRate(12_000, 900, 12)).toBeNull();
  });
  it('steps EMI dates month by month, clamping to month end', () => {
    expect(nextDueDate(5, '2026-11-09')).toBe('2026-12-05');
    expect(nextDueDate(31, '2026-11-09')).toBe('2026-11-30');
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(emisDueSince('2026-12-05', '2026-12-04')).toBe(0);
    expect(emisDueSince('2026-12-05', '2027-02-05')).toBe(3);
  });
});

describe('loanStatus', () => {
  it('splits what is left into principal and interest', () => {
    const s = loanStatus(loan(), '2026-11-09')!;
    expect(s.left).toBe(120);
    expect(s.payable).toBe(3_000_000);
    expect(s.outstanding).toBeCloseTo(presentValue(25_000, 120, 9), 1);
    expect(s.interestLeft! + s.outstanding!).toBeCloseTo(3_000_000, 1);
    expect(s.nextInterest).toBeCloseTo(s.outstanding! * 0.0075, 1);
    expect(s.nextDate).toBe('2026-12-05');
    expect(s.lastDate).toBe('2036-11-05');
  });
  it('rolls forward as EMIs fall due and closes at the end', () => {
    const later = loanStatus(loan(), '2027-03-10')!;
    expect(later.paidSinceUpdate).toBe(4);
    expect(later.left).toBe(116);
    expect(later.nextDate).toBe('2027-04-05');
    const done = loanStatus(loan({ monthsLeft: 2 }), '2027-06-01')!;
    expect(done.done).toBe(true);
    expect(done.payable).toBe(0);
    expect(debtBalanceNow(loan({ monthsLeft: 2 }), '2027-06-01')).toBe(0);
  });
  it('shows only the total left to pay when the rate is unknown', () => {
    const s = loanStatus(loan({ basis: 'none' }, 0), '2026-11-09')!;
    expect(s.payable).toBe(3_000_000);
    expect(s.outstanding).toBeNull();
    expect(s.interestLeft).toBeNull();
    expect(debtBalanceNow(loan({ basis: 'none' }, 0), '2026-11-09')).toBe(3_000_000);
  });
  it('reports lifetime progress when the original amount and tenure are known', () => {
    const emi = emiFor(2_000_000, 9, 240);
    const s = loanStatus(loan({ amount: emi, monthsLeft: 180, original: 2_000_000, tenure: 240 }), '2026-11-09')!;
    expect(s.life!.emisPaid).toBe(60);
    expect(s.life!.principalRepaid + s.outstanding!).toBeCloseTo(2_000_000, 0);
    expect(s.life!.totalInterest).toBeCloseTo(emi * 240 - 2_000_000, -1);
  });
  it('leaves non-EMI debts alone', () => {
    expect(loanStatus({ id: 'c', name: 'Card', currency: 'MYR', apr: 18, minPayment: 100, balance: 4000 })).toBeNull();
    expect(debtBalanceNow({ id: 'c', name: 'Card', currency: 'MYR', apr: 18, minPayment: 100, balance: 4000 })).toBe(4000);
  });
});

describe('schedule and prepayment', () => {
  const s = loanStatus(loan(), '2026-11-09')!;
  it('builds a schedule that pays off exactly', () => {
    const rows = schedule(s.outstanding!, 9, 25_000, s.nextDate!, 5);
    expect(rows.length).toBe(120);
    expect(rows.at(-1)!.balance).toBe(0);
    expect(rows[0].interest).toBeCloseTo(s.nextInterest!, 1);
    const years = scheduleByYear(rows);
    expect(years[0]).toMatchObject({ year: '2026', emis: 1 });
    expect(years.reduce((a, y) => a + y.emis, 0)).toBe(120);
  });
  it('shows interest saved by a lump sum or extra EMI', () => {
    const t = prepay(s, 200_000, 0, 'tenure', 5)!;
    expect(t.months).toBeLessThan(120);
    expect(t.saved).toBeGreaterThan(0);
    expect(t.newEmi).toBe(25_000);
    const e = prepay(s, 200_000, 0, 'emi', 5)!;
    expect(e.months).toBe(120);
    expect(e.newEmi).toBeLessThan(25_000);
    expect(e.saved).toBeLessThan(t.saved);
    const x = prepay(s, 0, 5000, 'tenure', 5)!;
    expect(x.monthsSaved).toBeGreaterThan(10);
    expect(prepay(s, 10_000_000, 0, 'tenure')!.closes).toBe(true);
  });
});

describe('resolveRate', () => {
  it('uses whichever detail is known', () => {
    expect(resolveRate({ emi: 25_000, monthsLeft: 120, basis: 'rate', apr: 8.5 }).apr).toBe(8.5);
    expect(resolveRate({ emi: 17_994.52, monthsLeft: 240, basis: 'outstanding', outstanding: 2_000_000 }).apr).toBeCloseTo(9, 2);
    expect(resolveRate({ emi: 17_994.52, monthsLeft: 180, basis: 'original', original: 2_000_000, tenure: 240 }).apr).toBeCloseTo(9, 2);
    expect(resolveRate({ emi: 1000, monthsLeft: 10, basis: 'none' })).toEqual({ apr: null });
    expect(resolveRate({ emi: 1000, monthsLeft: 10, basis: 'outstanding', outstanding: 50_000 }).error).toBeTruthy();
    expect(resolveRate({ emi: 0, monthsLeft: 10, basis: 'none' }).error).toBeTruthy();
  });
});
