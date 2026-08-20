import { describe, expect, it } from 'vitest';
import { parseHhResumeHtml } from './hhResumeParser';

describe('hhResumeParser', () => {
  it('parses full structured resume html correctly', () => {
    const html = `
      <div data-qa="resume-personal-name">Алексей Денисов</div>
      <div data-qa="resume-block-title-position">VP of Technology & Operations</div>
      <div data-qa="resume-block-about">Руководитель технологических продуктов и масштабирования.</div>
      <div data-qa="resume-block-address">Москва</div>
      <span data-qa="bloko-tag__text">TypeScript</span>
      <span data-qa="bloko-tag__text">React</span>
      <span data-qa="skills-element">Architecture</span>
      <div class="resume-block-item-gap">
        <div data-qa="resume-block-experience-position">Chief Technology Officer</div>
        <div data-qa="resume-block-experience-company">Tech Corp</div>
        <div data-qa="resume-block-experience-time-interval">Январь 2021 — настоящее время</div>
        <div data-qa="resume-block-experience-description">Руководство инженерной командой и запуск продуктов.</div>
      </div>
      <div class="resume-block-item-gap">
        <div data-qa="resume-block-experience-position">Lead Engineer</div>
        <div data-qa="resume-block-experience-company">Innovations LLC</div>
        <div data-qa="resume-block-experience-time-interval">Март 2018 — Декабрь 2020</div>
        <div data-qa="resume-block-experience-description">Разработка высоконагруженных сервисов.</div>
      </div>
      <div data-qa="resume-block-education">
        <div data-qa="resume-block-education-item">
          <div data-qa="resume-block-education-name">МГТУ им. Н.Э. Баумана</div>
          <div data-qa="resume-block-education-organization">Информатика и системы управления</div>
        </div>
      </div>
      <div data-qa="resume-block-languages">
        <div>Русский — Родной</div>
        <div>Английский — C1 — Продвинутый</div>
      </div>
    `;

    const result = parseHhResumeHtml(html, 'https://hh.ru/resume/test-token');

    expect(result.fullName).toBe('Алексей Денисов');
    expect(result.targetRole).toBe('VP of Technology & Operations');
    expect(result.about).toBe('Руководитель технологических продуктов и масштабирования.');
    expect(result.contact.location).toBe('Москва');
    expect(result.skills).toContain('TypeScript');
    expect(result.skills).toContain('React');
    expect(result.skills).toContain('Architecture');
    expect(result.experience).toHaveLength(2);
    expect(result.experience[0].title).toBe('Chief Technology Officer');
    expect(result.experience[0].employer).toBe('Tech Corp');
    expect(result.experience[0].current).toBe(true);
    expect(result.education).toHaveLength(1);
    expect(result.education[0].institution).toBe('МГТУ им. Н.Э. Баумана');
    expect(result.languages).toHaveLength(2);
    expect(result.languages[1].name).toBe('Английский');
    expect(result.languages[1].cefr).toBe('C1');
  });
});
