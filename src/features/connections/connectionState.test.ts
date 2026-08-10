import { describe, expect, it } from 'vitest';
import { CoachApiError } from '../coach/coachApi';
import { accountRequiredNotice, connectionStartNotice } from './connectionState';

describe('connection start failures', () => {
  it('explains that a connection needs an account instead of reporting a fault', () => {
    expect(
      connectionStartNotice(
        new CoachApiError('Нужна действующая сессия кандидата.', 'unauthorized', false),
        'hh',
      ),
    ).toBe(accountRequiredNotice('hh'));
  });

  it('states plainly that an unconfigured platform is not worked around', () => {
    expect(
      connectionStartNotice(
        new CoachApiError('Не настроено.', 'connector_not_configured', false),
        'linkedin',
      ),
    ).toMatch(/не обходим ограничения/i);
  });

  it('keeps document import available when the platform refuses', () => {
    expect(connectionStartNotice(new Error('offline'), 'linkedin')).toMatch(
      /экспорт|PDF/i,
    );
  });
});
