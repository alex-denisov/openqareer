import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { parseCbrDailyXml, readCurrencyRates, writeCurrencyRates } from './cbrRates';

const XML = `<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="27.10.2026" name="Foreign Currency Market">
<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>x</Name><Value>80,1234</Value><VunitRate>80,1234</VunitRate></Valute>
<Valute ID="R01335"><NumCode>398</NumCode><CharCode>KZT</CharCode><Nominal>100</Nominal><Name>x</Name><Value>16,5</Value><VunitRate>0,165</VunitRate></Valute>
<Valute ID="bad"><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>abc</Value></Valute>
</ValCurs>`;

describe('parseCbrDailyXml', () => {
  it('reads the date and rubles per one unit, skipping broken rows', () => {
    expect(parseCbrDailyXml(XML)).toEqual({
      date: '2026-10-27',
      rubPerUnit: { USD: 80.1234, KZT: 0.165 },
    });
  });

  it('rejects a page without rates', () => {
    expect(parseCbrDailyXml('<html>blocked</html>')).toBeUndefined();
  });
});

describe('currency_rates table', () => {
  it('round-trips the latest rates and reads nothing before the first write', () => {
    const db = new DatabaseSync(':memory:');
    expect(readCurrencyRates(db)).toBeUndefined();
    const rates = { date: '2026-10-27', rubPerUnit: { USD: 80, KZT: 0.165 } };
    writeCurrencyRates(db, rates, new Date('2026-10-27T10:00:00Z'));
    writeCurrencyRates(db, rates, new Date('2026-10-27T11:00:00Z'));
    expect(readCurrencyRates(db)).toEqual(rates);
  });
});
