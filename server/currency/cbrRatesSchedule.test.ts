import { describe, expect, it } from 'vitest';
import { fetchCbrRates } from './cbrRatesSchedule';

const XML = `<ValCurs Date="27.10.2026"><Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>80,5</Value><VunitRate>80,5</VunitRate></Valute></ValCurs>`;

function response(body: string, ok = true): Response {
  return new Response(new TextEncoder().encode(body), { status: ok ? 200 : 503 });
}

describe('fetchCbrRates', () => {
  it('reads the official page first', async () => {
    const urls: string[] = [];
    const rates = await fetchCbrRates(async (url) => {
      urls.push(String(url));
      return response(XML);
    });
    expect(rates?.rubPerUnit.USD).toBe(80.5);
    expect(urls).toHaveLength(1);
  });

  it('falls back to the mirror when the official page fails or is blocked', async () => {
    const urls: string[] = [];
    const rates = await fetchCbrRates(async (url) => {
      urls.push(String(url));
      if (urls.length === 1) return response('<html>blocked</html>');
      return response(XML);
    });
    expect(rates?.date).toBe('2026-10-27');
    expect(urls).toHaveLength(2);
  });

  it('returns undefined when both sources fail', async () => {
    const rates = await fetchCbrRates(async () => {
      throw new Error('network');
    });
    expect(rates).toBeUndefined();
  });
});
