import { CURRENCIES } from '../core/currency';
import { CategoryKind, Settings } from '../core/models';

/** Currencies in use first, then the rest of the list. */
export function currencyChoices(s: Settings, extra?: string): { code: string; label: string; divider?: boolean }[] {
  const used = [...new Set([...s.currencies, ...(extra ? [extra] : [])])];
  return [
    ...used.map((c) => ({ code: c, label: c })),
    ...CURRENCIES.filter(([c]) => !used.includes(c)).map(([c, n]) => ({ code: c, label: `${c} · ${n}` })),
  ];
}

export const categoriesOf = (s: Settings, kind: CategoryKind) => s.categories.filter((c) => c.kind === kind);
export const activeAccounts = (s: Settings, keep?: string | null) => s.accounts.filter((a) => !a.archived || a.id === keep);

export function ensureCurrency(s: Settings, c: string) {
  if (c && !s.currencies.includes(c)) s.currencies.push(c);
}
