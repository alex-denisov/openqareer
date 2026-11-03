import { describe, expect, it } from 'vitest';
import { errorDiagnostics } from './errorDiagnostics';

describe('request-failed diagnostics (prod 03.11: 104 failures logged as a bare «Error»)', () => {
  it('keeps the message and the top five frames, without the message line', () => {
    const error = new Error('Expression tree is too large (maximum depth 1000)');
    error.stack = [
      'Error: Expression tree is too large (maximum depth 1000)',
      ...Array.from({ length: 8 }, (_, index) => `    at frame${index} (/srv/server.mjs:1:${index})`),
    ].join('\n');

    const diagnostics = errorDiagnostics(error);

    expect(diagnostics.errorMessage).toBe('Expression tree is too large (maximum depth 1000)');
    expect(diagnostics.errorStack).toEqual([0, 1, 2, 3, 4].map((index) => `at frame${index} (/srv/server.mjs:1:${index})`));
  });

  it('masks e-mails, long numbers and token-like values and caps the message at 300 characters', () => {
    const message = `no row for anna.sedova@example.com phone 79991234567 key=sk-abcdefghijklmnopqrstuv ${'x'.repeat(400)}`;

    const { errorMessage } = errorDiagnostics(new Error(message));

    expect(errorMessage).not.toContain('anna.sedova@example.com');
    expect(errorMessage).not.toContain('79991234567');
    expect(errorMessage).not.toContain('sk-abcdefghijklmnopqrstuv');
    expect(errorMessage!.length).toBeLessThanOrEqual(300);
  });

  it('logs nothing extra for a value that is not an Error', () => {
    expect(errorDiagnostics('boom')).toEqual({});
  });
});
