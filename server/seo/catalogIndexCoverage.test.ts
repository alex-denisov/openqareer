import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { checkIndexCoverage } from './catalogIndexCoverage';

const DAY = 86_400_000;
const START = Date.parse('2026-10-20T12:00:00.000Z');

function harness() {
  const database = new DatabaseSync(':memory:');
  const sent: string[] = [];
  const logged: string[] = [];
  let outcome: 'sent' | 'failed' = 'sent';
  const run = (day: number, jobs: number, listings: number) =>
    checkIndexCoverage({
      database,
      files: [
        { name: 'static-1.xml', urlCount: 21 },
        { name: 'listings-1.xml', urlCount: listings },
        { name: 'jobs-1.xml', urlCount: jobs },
      ],
      telegram: {},
      log: {
        error: (_details, message) => logged.push(message),
      },
      now: new Date(START + day * DAY),
      notify: async (_config, text) => {
        sent.push(text);
        return outcome === 'sent'
          ? { status: 'sent', httpStatus: 200, messageId: 1 }
          : { status: 'failed', reason: 'network' };
      },
    });
  return { run, sent, logged, failNext: () => (outcome = 'failed'), recover: () => (outcome = 'sent') };
}

describe('checkIndexCoverage', () => {
  it('stays quiet without a baseline and within the usual drift', async () => {
    const { run, sent } = harness();
    await run(0, 1000, 500);
    await run(0, 100, 50); // the same day is not its own baseline
    await run(1, 850, 500);
    await run(2, 1000, 410);
    expect(sent).toEqual([]);
  });

  it('alerts when cards or listings fall over 20 % below the last 7 days', async () => {
    const { run, sent, logged } = harness();
    await run(0, 2455, 2633);
    await run(1, 2400, 1492);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('1492');
    expect(sent[0]).toContain('2633');
    expect(sent[0]).toContain('43 %');
    expect(logged).toEqual(['catalog-index-coverage-drop']);
    await run(2, 1900, 2600);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('1900');
  });

  it('alerts once per kind per week while the drop lasts', async () => {
    const { run, sent } = harness();
    await run(0, 1000, 500);
    await run(1, 500, 500);
    await run(2, 500, 500);
    await run(6, 500, 500);
    expect(sent).toHaveLength(1);
  });

  it('retries the next run when Telegram failed', async () => {
    const { run, sent, failNext, recover } = harness();
    await run(0, 1000, 500);
    failNext();
    await run(1, 500, 500);
    recover();
    await run(1, 500, 500);
    await run(1, 500, 500);
    expect(sent).toHaveLength(2);
  });

  it('forgets a baseline older than 7 days', async () => {
    const { run, sent } = harness();
    await run(0, 1000, 500);
    await run(8, 500, 500);
    expect(sent).toEqual([]);
  });

  it('never throws into the sitemap job', async () => {
    const database = new DatabaseSync(':memory:');
    database.close();
    const logged: string[] = [];
    await expect(
      checkIndexCoverage({
        database,
        files: [],
        telegram: {},
        log: { error: (_details, message) => logged.push(message) },
      }),
    ).resolves.toBeUndefined();
    expect(logged).toEqual(['catalog-index-coverage-failed']);
  });
});
