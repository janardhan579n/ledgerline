import { Pipe, PipeTransform } from '@angular/core';
import { MoneyOpts, formatMoney } from '../core/currency';

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, currency: string, opts?: MoneyOpts | 'compact' | 'abs'): string {
    const o: MoneyOpts = typeof opts === 'string' ? { [opts]: true } : opts ?? {};
    return formatMoney(value, currency, o);
  }
}
