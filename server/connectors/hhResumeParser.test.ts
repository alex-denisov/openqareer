import { describe, expect, it } from 'vitest';
import { parseHhResumeHtml, parseHhResumeFromUrl } from './hhResumeParser';

describe('hhResumeParser', () => {
  const sampleHhHtml = `
    <!DOCTYPE html>
    <html>
    <body>
      <div data-qa="resume-personal-name">Мария Иванова</div>
      <div data-qa="resume-block-title-position">VP of Technology & Operations</div>
      <div data-qa="resume-block-salary">350 000 руб. на руки</div>
      <div data-qa="resume-block-address">Москва</div>
      <div data-qa="resume-block-skills-content">
        <span data-qa="bloko-tag__text">TypeScript</span>
        <span data-qa="bloko-tag__text">React</span>
        <span data-qa="bloko-tag__text">Node.js</span>
        <span data-qa="bloko-tag__text">PostgreSQL</span>
        <span data-qa="bloko-tag__text">Team Leadership</span>
      </div>
      <div data-qa="resume-block-experience">
        <div class="resume-block-item-gap">
          <div data-qa="resume-block-experience-time-interval">Январь 2022 — настоящее время (2 года 8 месяцев)</div>
          <div data-qa="resume-block-experience-position">VP of Engineering / Operations</div>
          <div data-qa="resume-block-experience-company">TechCorp International</div>
          <div data-qa="resume-block-experience-description">Руководство технической дирекцией из 40+ инженеров. Достиг роста NPS на 35% и сокращения Time-to-Market в 2.5 раза.</div>
        </div>
        <div class="resume-block-item-gap">
          <div data-qa="resume-block-experience-time-interval">Март 2018 — Декабрь 2021 (3 года 10 месяцев)</div>
          <div data-qa="resume-block-experience-position">Lead Software Architect</div>
          <div data-qa="resume-block-experience-company">Fintech Platform</div>
          <div data-qa="resume-block-experience-description">Проектирование распределенной архитектуры обработки платежей.</div>
        </div>
      </div>
      <div data-qa="resume-block-education">
        <div data-qa="resume-block-education-item">
          <div data-qa="resume-block-education-name">МГТУ им. Н.Э. Баумана</div>
          <div data-qa="resume-block-education-organization">Информатика и системы управления</div>
        </div>
      </div>
      <div data-qa="resume-block-languages">
        <p>Русский — Родной</p>
        <p>Английский — C1 — Продвинутый</p>
      </div>
      <div data-qa="resume-block-about">
        Управление распределенными инженерными командами, цифровизация операций и выстраивание надежных процессов доставки ценности.
      </div>
    </body>
    </html>
  `;

  it('extracts structured candidate profile and facts from hh.ru HTML page', () => {
    const parsed = parseHhResumeHtml(sampleHhHtml, 'https://hh.ru/resume/test-token-123');

    expect(parsed.fullName).toBe('Мария Иванова');
    expect(parsed.targetRole).toBe('VP of Technology & Operations');
    expect(parsed.skills).toContain('TypeScript');
    expect(parsed.skills).toContain('React');
    expect(parsed.skills).toContain('Node.js');
    expect(parsed.skills).toContain('Team Leadership');
    expect(parsed.experience).toHaveLength(2);
    expect(parsed.experience[0].title).toBe('VP of Engineering / Operations');
    expect(parsed.experience[0].employer).toBe('TechCorp International');
    expect(parsed.experience[0].current).toBe(true);
    expect(parsed.education).toHaveLength(1);
    expect(parsed.education[0].institution).toContain('Баумана');
    expect(parsed.languages.some((l) => l.name.toLowerCase().includes('английский'))).toBe(true);
    expect(parsed.about).toContain('командами');
  });

  it('fetches and imports hh.ru resume via parseHhResumeFromUrl with mock fetch', async () => {
    const mockFetch = async () => new Response(sampleHhHtml, { status: 200 });
    const result = await parseHhResumeFromUrl('https://hh.ru/resume/test-token-123', {
      fetchImpl: mockFetch as typeof fetch,
    });

    expect(result.status).toBe('imported');
    if (result.status === 'imported') {
      expect(result.platform).toBe('hh');
      expect(result.facts.length).toBeGreaterThan(0);
      expect(result.facts.some((f) => f.kind === 'headline' && f.value.includes('VP'))).toBe(true);
      expect(result.facts.some((f) => f.kind === 'summary')).toBe(true);
    }
  });
});
