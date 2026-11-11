import { describe, expect, it } from 'vitest';
import { DEFAULT_VACANCY_SOURCES, vacancySourceMeasurements } from './defaultVacancySources';
import { FREEHIRE_TELEGRAM_SOURCES } from './freehireTelegramSources';

describe('B646-8 freehire Telegram channels', () => {
  it('registers each channel once with a measurement from the prod route', () => {
    expect(FREEHIRE_TELEGRAM_SOURCES.length).toBeGreaterThanOrEqual(40);
    for (const source of FREEHIRE_TELEGRAM_SOURCES) {
      expect(DEFAULT_VACANCY_SOURCES.filter((s) => s.id === source.id)).toHaveLength(1);
      expect(DEFAULT_VACANCY_SOURCES.filter((s) => s.targetUrl === source.targetUrl)).toHaveLength(
        1,
      );
      const measured = vacancySourceMeasurements(source.id);
      expect(measured.some((m) => m.route === 'eu-prod' && m.items >= 3)).toBe(true);
    }
  });
});
