import { describe, expect, it } from 'vitest';
import { firstRepeat } from './tx-form';

describe('repeat a transaction', () => {
  it('starts with the next date after the transaction', () => {
    expect(firstRepeat('2026-11-05', 'monthly', '2026-11-11')).toBe('2026-12-05');
    expect(firstRepeat('2026-11-11', 'weekly', '2026-11-11')).toBe('2026-11-18');
    expect(firstRepeat('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
    expect(firstRepeat('2026-11-11', 'yearly', '2026-11-11')).toBe('2027-11-11');
  });
  it("doesn't back-fill when an old bill is recorded late", () => {
    expect(firstRepeat('2026-09-05', 'monthly', '2026-11-11')).toBe('2026-12-05');
  });
});
