import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VACANCY_SOURCES,
  vacancySourceMeasurement,
} from './defaultVacancySources';

/**
 * B164 — the registry used to carry sources nobody had ever contacted, and
 * several of the addresses turned out not to exist. A registered source now
 * has to say which access class it belongs to and what a live probe actually
 * returned, and it may only be enabled if that probe returned vacancies.
 */
describe('registry of vacancy sources', () => {
  it('gives every source an access class the owner named', () => {
    for (const source of DEFAULT_VACANCY_SOURCES) {
      expect(['open_web', 'api', 'browser_session']).toContain(source.accessClass);
    }
  });

  it('never enables a source that has not been observed returning vacancies', () => {
    for (const source of DEFAULT_VACANCY_SOURCES) {
      const measurement = vacancySourceMeasurement(source.id);
      expect(measurement, `${source.id} has no measurement`).toBeDefined();
      if (source.enabled) {
        expect(measurement!.items, `${source.id} is enabled with an empty probe`).toBeGreaterThan(0);
      }
    }
  });

  it('dates every measurement, so a stale registry is visible', () => {
    for (const source of DEFAULT_VACANCY_SOURCES) {
      const measurement = vacancySourceMeasurement(source.id)!;
      expect(Number.isNaN(Date.parse(measurement.observedAt))).toBe(false);
    }
  });

  it('declares the transport it actually speaks, not the one it resembles', () => {
    const remoteok = DEFAULT_VACANCY_SOURCES.find((source) => source.id === 'src-remoteok');

    // It was registered as `rss` while pointing at a JSON endpoint (B161 review §6).
    expect(remoteok?.type).toBe('json_api');
    expect(remoteok?.targetUrl).toContain('remoteok.com/api');
  });

  it('carries no duplicate ids and no duplicate endpoints', () => {
    const ids = DEFAULT_VACANCY_SOURCES.map((source) => source.id);
    const urls = DEFAULT_VACANCY_SOURCES.map((source) => source.targetUrl);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('keeps a disabled source only with a written reason', () => {
    for (const source of DEFAULT_VACANCY_SOURCES.filter((entry) => !entry.enabled)) {
      expect(source.disabledReason, `${source.id} is disabled without a reason`).toBeTruthy();
    }
  });

  it('marks a source that answers nothing without a query, so a scheduled sync skips it', () => {
    const getonbrd = DEFAULT_VACANCY_SOURCES.find((source) => source.id === 'src-getonbrd');

    expect(getonbrd?.requiresQuery).toBe(true);
  });
});
