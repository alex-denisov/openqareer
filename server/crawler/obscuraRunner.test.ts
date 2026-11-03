import { describe, expect, it } from 'vitest';
import { ObscuraRunner } from './obscuraRunner';

describe('ObscuraRunner without the binary', () => {
  it('reports a missing binary as source_not_configured, not a raw spawn error', async () => {
    const runner = new ObscuraRunner(
      {},
      {
        execFile: async () => {
          throw Object.assign(new Error('spawn obscura ENOENT'), { code: 'ENOENT' });
        },
      },
    );
    await expect(runner.fetchHtml('https://example.com')).rejects.toThrow(/^source_not_configured/);
  });

  it('passes other failures through unchanged', async () => {
    const runner = new ObscuraRunner(
      {},
      {
        execFile: async () => {
          throw new Error('timeout');
        },
      },
    );
    await expect(runner.fetchHtml('https://example.com')).rejects.toThrow('timeout');
  });
});
