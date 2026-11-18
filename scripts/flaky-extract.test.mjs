import { describe, expect, it } from 'vitest';
import { extract, fromPlaywright, fromVitest } from './flaky-extract.mjs';
import { aggregate } from './flaky-report.mjs';

const playwright = {
  suites: [
    {
      title: 'b511.spec.ts',
      file: 'b511.spec.ts',
      specs: [],
      suites: [
        {
          title: 'B511 G3b',
          specs: [
            {
              title: 'итог тренажёра',
              file: 'b511.spec.ts',
              tests: [
                {
                  projectName: 'desktop-1440',
                  status: 'flaky',
                  results: [
                    {
                      status: 'timedOut',
                      error: {
                        message: '\u001b[31mTest timeout of 30000ms exceeded.\u001b[39m\nmore',
                      },
                    },
                    { status: 'passed' },
                  ],
                },
                { projectName: 'mobile-390', status: 'expected', results: [{ status: 'passed' }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const vitest = {
  testResults: [
    {
      name: '/repo/server/a.test.ts',
      status: 'failed',
      assertionResults: [
        { fullName: 'A > ok', status: 'passed', retryCount: 0 },
        { fullName: 'A > retried', status: 'passed', retryCount: 1 },
        { fullName: 'A > broken', status: 'failed', failureMessages: ['Error: ENOTEMPTY\n at x'] },
      ],
    },
  ],
};

describe('flaky extract', () => {
  it('keeps Playwright tests that passed only on retry, with the first error line', () => {
    expect(fromPlaywright(playwright)).toEqual([
      {
        status: 'flaky',
        file: 'b511.spec.ts',
        title: 'B511 G3b › итог тренажёра',
        project: 'desktop-1440',
        retries: 1,
        error: 'Test timeout of 30000ms exceeded.',
      },
    ]);
  });

  it('keeps Vitest failures and retried passes, not clean passes', () => {
    const tests = fromVitest(vitest, '/repo');
    expect(tests.map((test) => [test.status, test.title, test.file])).toEqual([
      ['flaky', 'A > retried', 'server/a.test.ts'],
      ['failed', 'A > broken', 'server/a.test.ts'],
    ]);
    expect(tests[1].error).toBe('Error: ENOTEMPTY');
  });

  it('detects the report kind', () => {
    expect(extract(vitest, { cwd: '/repo' }).kind).toBe('unit');
    expect(extract(playwright, {}).kind).toBe('e2e');
  });
});

describe('flaky report', () => {
  const record = (overrides, tests) => ({
    kind: 'e2e',
    sha: 'aaa',
    runId: 1,
    attempt: 1,
    job: 'e2e-1',
    createdAt: '2026-11-18T00:00:00Z',
    tests,
    ...overrides,
  });
  const flakyTest = {
    status: 'flaky',
    file: 'b511.spec.ts',
    title: 'T',
    project: 'desktop-1440',
    error: 'timeout',
  };
  const failedTest = { ...flakyTest, status: 'failed' };

  it('counts retry passes and failures that passed on a later attempt of the same sha', () => {
    const rows = aggregate([
      record({}, [flakyTest]),
      record({ sha: 'bbb', runId: 2 }, [failedTest]),
      record({ sha: 'bbb', runId: 2, attempt: 2, createdAt: '2026-11-18T01:00:00Z' }, []),
      record({ sha: 'ccc', runId: 3 }, [failedTest]),
      record({ sha: 'ddd', runId: 4, job: 'e2e-2' }, []),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ flaky: 2, retryPass: 1, rerunPass: 1, hardFail: 1, runs: 5 });
  });
});
