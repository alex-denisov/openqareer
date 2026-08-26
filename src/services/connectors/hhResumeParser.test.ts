import { describe, expect, it } from 'vitest';
import { parseHhResumeHtml, parseHhResumesList } from './hhResumeParser';

describe('hhResumeParser', () => {
  it('parses full structured resume html correctly', () => {
    const html = `
      <div data-qa="resume-personal-name">Мария Иванова</div>
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

    expect(result.fullName).toBe('Мария Иванова');
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

  it('parses the classic resume-title link regardless of safe attribute order', () => {
    expect(
      parseHhResumesList(
        '<a data-qa="resume-title" class="resume-link" href="/resume/live-token-542">Head of Product</a>',
      ),
    ).toEqual([
      {
        id: 'live-token-542',
        title: 'Head of Product',
        url: 'https://hh.ru/resume/live-token-542',
        updatedLabel: 'Готово к импорту',
      },
    ]);
  });

  it('reads a resume card that carries no data-qa at all', () => {
    // hh.ru renames its `data-qa` attributes between releases. Gating on them
    // emptied the candidate's resume list on a page that plainly showed their
    // resumes, and the step then blamed the sign-in (B157).
    expect(
      parseHhResumesList(
        '<div class="resume-card"><a class="magritte-link" href="/resume/live-token-903">Менеджер по продукту</a></div>',
      ),
    ).toEqual([
      {
        id: 'live-token-903',
        title: 'Менеджер по продукту',
        url: 'https://hh.ru/resume/live-token-903',
        updatedLabel: 'Готово к импорту',
      },
    ]);
  });

  it('keeps the readable title when one card links the same resume twice', () => {
    const resumes = parseHhResumesList(
      '<a href="/resume/live-token-903"><svg></svg></a>' +
        '<a href="/resume/live-token-903">Менеджер по продукту</a>',
    );

    expect(resumes).toHaveLength(1);
    expect(resumes[0].title).toBe('Менеджер по продукту');
  });

  it('accepts an absolute hh.ru resume link and a trailing slash', () => {
    expect(
      parseHhResumesList(
        '<a href="https://hh.ru/resume/live-token-11/">Аналитик</a>',
      ).map((resume) => resume.id),
    ).toEqual(['live-token-11']);
  });

  it('never reads a link that is not a resume of this candidate', () => {
    expect(
      parseHhResumesList(
        '<a href="/applicant/resumes">Мои резюме</a>' +
          '<a href="/resume/../evil">Нет</a>' +
          '<a href="https://example.invalid/resume/live-token-9">Чужое</a>' +
          '<a href="/vacancy/123">Вакансия</a>',
      ),
    ).toEqual([]);
  });

  it('parses a sanitised resume link regardless of safe attribute order', () => {
    expect(
      parseHhResumesList(
        '<a data-qa="resume-card-link-731" class="resume-link" href="/resume/live-token-731">Product Director</a>',
      ),
    ).toEqual([
      {
        id: 'live-token-731',
        title: 'Product Director',
        url: 'https://hh.ru/resume/live-token-731',
        updatedLabel: 'Готово к импорту',
      },
    ]);
  });
});

/**
 * B157, owner report 2026-08-26 — «импорт не работает».
 *
 * hh.ru replaced the resume page with the Magritte profile surface, and this
 * parser still spoke the old one. A live capture of the dedicated test account
 * on 2026-08-26 produced **20 characters** of `rawText` out of a 127 KB page:
 * the job title, and nothing else. Six skills, the education level, the salary
 * line, the employment terms and both contacts were all on screen and none of
 * them reached the profile.
 *
 * The markup below is the live shape with the account's own values replaced.
 */
describe('the hh.ru profile surface as it is served today', () => {
  const PROFILE_PAGE = `
    <div data-qa="resume-position-card" class="magritte-card___bhGKz">
      <div data-qa="title-container" class="magritte-text-alignment-left___BreG5">
        <h1 data-qa="resume-block-title-position" class="magritte-text___gMq2l">Менеджер по продукту</h1>
        <div class="magritte-text-dynamic___71-Al">
          <div data-qa="resume-block-salary" class="magritte-text___gMq2l">
            <div class="magritte-text___pbpft"><span>200&nbsp;000 ₽</span></div>
          </div>
        </div>
      </div>
      <div data-qa="resume-position-field-employmentForms" class="magritte-cell___NQYg5">
        <div data-qa="cell-text-content">Тип занятости:</div>
        <div data-qa="cell-text-content">Постоянная работа</div>
      </div>
      <div data-qa="resume-position-field-workFormats" class="magritte-cell___NQYg5">
        <div data-qa="cell-text-content">Формат работы:</div>
        <div data-qa="cell-text-content">На месте работодателя</div>
      </div>
    </div>
    <div data-qa="resume-contacts-phone">
      <span data-qa="resume-contact-phone-value-preferred-text" class="magritte-text___tkzIl">+7 900 000-00-00</span>
    </div>
    <span data-qa="resume-contact-email-value-text" class="magritte-text___tkzIl">candidate@example.test</span>
    <div data-qa="skills-card" class="magritte-card___bhGKz">
      <div>
        <div data-qa="skill-level-title-3" class="magritte-text___pbpft">Продвинутый уровень</div>
        <div class="tags--ByGViNxdOEwBOVW8">
          <div data-qa="skill-tag-5488" class="magritte-tag___WdGxk">
            <div class="magritte-tag__label___YHV-o"><span>Английский язык</span></div>
          </div>
          <div data-qa="skill-tag-4661687" class="magritte-tag___WdGxk">
            <div class="magritte-tag__label___YHV-o"><span>Unit-экономика</span></div>
          </div>
        </div>
      </div>
      <div>
        <div data-qa="skill-level-title-2" class="magritte-text___pbpft">Средний уровень</div>
        <div class="tags--ByGViNxdOEwBOVW8">
          <div data-qa="skill-tag-144021" class="magritte-tag___WdGxk">
            <div class="magritte-tag__label___YHV-o"><span>Международные рынки</span></div>
          </div>
        </div>
      </div>
    </div>
    <div data-qa="resume-list-card-education">
      <div data-qa="title-container"><h4 data-qa="title">Образование</h4></div>
      <div data-qa="resume-list-card-education-item-educationLevel" class="magritte-cell___NQYg5">
        <div data-qa="cell-left-side">
          <div data-qa="cell-text"><div data-qa="cell-text-content">Уровень</div></div>
          <div data-qa="cell-text"><div data-qa="cell-text-content">Среднее</div></div>
        </div>
      </div>
    </div>
  `;

  it('reads the skills hh.ru now renders as levelled tags', () => {
    const parsed = parseHhResumeHtml(PROFILE_PAGE, 'https://hh.ru/resume/token');

    expect(parsed.skills).toEqual([
      'Английский язык',
      'Unit-экономика',
      'Международные рынки',
    ]);
  });

  it('reads the contacts, the salary line and the employment terms', () => {
    const parsed = parseHhResumeHtml(PROFILE_PAGE, 'https://hh.ru/resume/token');

    expect(parsed.contact.email).toBe('candidate@example.test');
    expect(parsed.contact.phone).toBe('+7 900 000-00-00');
    expect(parsed.additional?.workSchedule).toContain('Постоянная работа');
    expect(parsed.about).toContain('200 000 ₽');
  });

  it('reads the education level card', () => {
    const parsed = parseHhResumeHtml(PROFILE_PAGE, 'https://hh.ru/resume/token');

    expect(parsed.education).toHaveLength(1);
    expect(parsed.education[0].institution).toContain('Среднее');
  });

  /**
   * `rawText` is the only thing the candidate API ever sees. Everything the
   * parser found and left out of it is a fact the profile never receives — and
   * a thin enough `rawText` is refused outright as `resume_without_facts`.
   */
  it('carries everything it found into the text the server imports', () => {
    const { rawText } = parseHhResumeHtml(PROFILE_PAGE, 'https://hh.ru/resume/token');

    expect(rawText).toContain('Менеджер по продукту');
    expect(rawText).toContain('Unit-экономика');
    expect(rawText).toContain('Среднее');
    expect(rawText).toContain('candidate@example.test');
    expect(rawText.length).toBeGreaterThan(150);
  });
});

describe('the resume card label the candidate picks from', () => {
  it('drops the update stamp hh.ru glues into the same link and decodes its entities', () => {
    const html =
      '<a data-qa="resume-card-link-260801" href="/resume/260801e7ff10">' +
      'Менеджер по продукту Обновлено 9&nbsp;августа&nbsp;2026&nbsp;в&nbsp;16:09</a>';

    expect(parseHhResumesList(html)).toEqual([
      {
        id: '260801e7ff10',
        title: 'Менеджер по продукту',
        url: 'https://hh.ru/resume/260801e7ff10',
        updatedLabel: 'Готово к импорту',
      },
    ]);
  });
});
