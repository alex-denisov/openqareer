import { describe, expect, it } from 'vitest';
import {
  extractDouVacanciesFromHtml,
  parseDouCompanyVacanciesHtml,
} from './douVacanciesAdapter';

const SAMPLE_DOU_HTML = `
<!DOCTYPE html>
<html>
<body>
<div class="b-company-vacancies">
  <ul class="lt">
    <li class="l-vacancy" _id="377660">
      <div class="title">
        <a class="vt" href="https://jobs.dou.ua/companies/stepico-games/vacancies/377660/?from=list_hot">Middle/Senior 2D Animator (Contractor)</a>
        <span class="salary">$2000–3500</span>
        <span class="cities">Львів, віддалено</span>
      </div>
      <div class="sh-desc">
        We are looking for a talented 2D Animator to join our game development studio.
      </div>
    </li>
    <li class="l-vacancy" _id="378905">
      <div class="title">
        <a class="vt" href="https://jobs.dou.ua/companies/stepico-games/vacancies/378905/">Unity Developer</a>
        <span class="cities">Remote</span>
      </div>
      <div class="sh-desc">
        Join our core team building next-generation casual and midcore titles.
      </div>
    </li>
  </ul>
</div>
</body>
</html>
`;

describe('douVacanciesAdapter', () => {
  it('extracts raw vacancies from DOU company HTML markup', () => {
    const raw = extractDouVacanciesFromHtml(SAMPLE_DOU_HTML);
    expect(raw).toHaveLength(2);

    expect(raw[0]).toEqual({
      id: '377660',
      title: 'Middle/Senior 2D Animator (Contractor)',
      url: 'https://jobs.dou.ua/companies/stepico-games/vacancies/377660/',
      location: 'Львів, віддалено',
      salaryText: '$2000–3500',
      description: 'We are looking for a talented 2D Animator to join our game development studio.',
    });

    expect(raw[1]?.title).toBe('Unity Developer');
    expect(raw[1]?.url).toBe('https://jobs.dou.ua/companies/stepico-games/vacancies/378905/');
    expect(raw[1]?.location).toBe('Remote');
  });

  it('transforms raw DOU items into UnifiedVacancy with priority 100 and clean provenance', () => {
    const vacancies = parseDouCompanyVacanciesHtml(SAMPLE_DOU_HTML, {
      company: 'Stepico Games',
      companySlug: 'stepico-games',
      sourceUrl: 'https://jobs.dou.ua/companies/stepico-games/vacancies/',
      observedAt: '2026-11-05',
    });

    expect(vacancies).toHaveLength(2);
    const first = vacancies[0]!;

    expect(first.id).toBe('dou-stepico-games-377660');
    expect(first.company).toBe('Stepico Games');
    expect(first.title).toBe('Middle/Senior 2D Animator (Contractor)');
    expect(first.isRemote).toBe(true);
    expect(first.provenance).toEqual({
      sourceType: 'career_site',
      sourceId: 'dou-stepico-games',
      sourceName: 'DOU (Stepico Games)',
      sourceUrl: 'https://jobs.dou.ua/companies/stepico-games/vacancies/',
      externalId: '377660',
      observedAt: '2026-11-05',
    });
    expect(first.fingerprint).toBeDefined();
    expect(first.fingerprint.length).toBe(64);
  });

  it('handles empty or vacancy-less pages without error', () => {
    const empty = parseDouCompanyVacanciesHtml('<html><body>No vacancies here</body></html>', {
      company: 'Empty Company',
      companySlug: 'empty',
      sourceUrl: 'https://jobs.dou.ua/companies/empty/vacancies/',
    });
    expect(empty).toEqual([]);
  });
});
