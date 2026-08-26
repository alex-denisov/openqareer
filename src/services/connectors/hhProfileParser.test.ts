import { describe, expect, it } from 'vitest';
import { parseHhProfilePage, withHhProfileIdentity } from './hhProfileParser';
import type { ParsedResume } from '../../features/workspace/resumeParser';

/**
 * The shape hh.ru serves at `/applicant/profile/me`, reduced the way the
 * desktop shell reduces it. Captured from the dedicated test account on
 * 2026-08-26 and rewritten with invented values (B172, INC-023).
 */
const PROFILE_PAGE = `
  <div data-qa="applicant-profile-avatar"></div>
  <div data-qa="title-container"><h1 data-qa="title">Мария Иванова</h1></div>
  <div class="magritte-text___pbpft">42 года · Россия</div>
  <div data-qa="cell-text"><span data-qa="cell-text-content">Где живёте</span></div>
  <div data-qa="cell-text"><span data-qa="cell-text-content">Казань · Метро не указано</span></div>
  <div data-qa="cell-text"><span data-qa="cell-text-content">Где ищете работу</span></div>
  <div data-qa="cell-text"><span data-qa="cell-text-content">Не&nbsp;указано</span></div>
  <div data-qa="profile-experience-card-empty">
    <div>Добавьте опыт, чтобы привлечь внимание работодателей</div>
  </div>
  <div data-qa="profile-language-card">
    <button data-qa="profile-language-card-row-0">
      <div data-qa="cell-text-content">Русский</div>
      <div data-qa="cell-text-content"><div class="degree--x"><span>Родной</span></div></div>
    </button>
    <button data-qa="profile-language-card-row-1">
      <div data-qa="cell-text-content">Английский</div>
      <div data-qa="cell-text-content"><div class="degree--x"><span>C1 — Продвинутый</span></div></div>
    </button>
  </div>
`;

/** What the resume page alone produces today: no name, no city, no languages. */
function resumePageOnly(): ParsedResume {
  return {
    targetRole: 'Менеджер по продукту',
    contact: { email: 'candidate@example.test', links: [] },
    experience: [],
    skills: ['Unit-экономика'],
    education: [],
    courses: [],
    tests: [],
    recommendations: [],
    languages: [],
    rawText: 'Менеджер по продукту\n\ncandidate@example.test',
  };
}

describe('the hh.ru profile page', () => {
  /**
   * The candidate's name is not on the resume page at all on hh.ru's current
   * surface — the profile page is the only place it is rendered. Without it
   * the cabinet greets the candidate by their openqareer login
   * (owner report, 2026-08-26).
   */
  it('reads the name the resume page never carries', () => {
    expect(parseHhProfilePage(PROFILE_PAGE).fullName).toBe('Мария Иванова');
  });

  it('reads the city from the labelled cell, not from the label', () => {
    expect(parseHhProfilePage(PROFILE_PAGE).location).toBe('Казань');
  });

  it('reads the languages and the level hh.ru states for each', () => {
    expect(parseHhProfilePage(PROFILE_PAGE).languages).toEqual([
      { name: 'Русский' },
      { name: 'Английский', cefr: 'C1' },
    ]);
  });

  /**
   * An empty work history is a fact about the source, not a failure of the
   * import. Only hh.ru's own empty card may assert it.
   */
  it('reports that hh.ru itself declared the work history empty', () => {
    expect(parseHhProfilePage(PROFILE_PAGE).experienceDeclaredEmpty).toBe(true);
    expect(parseHhProfilePage('<div></div>').experienceDeclaredEmpty).toBe(false);
  });

  /**
   * «Родной» is not a CEFR level, and the page below the card is full of text
   * that contains those two characters. A level the source never stated must
   * not appear next to the language (live capture, 2026-08-26).
   */
  it('never borrows a level from the page text below the card', () => {
    const page = `${PROFILE_PAGE}<h4>Подтверждение навыков</h4><span>C2</span><span>C1</span>`;

    expect(parseHhProfilePage(page).languages[0]).toEqual({ name: 'Русский' });
  });

  /**
   * Position is the only thing tying a value to its label, so a repeated value
   * further up the page must not shift the pairs by one.
   */
  it('keeps label and value paired when an earlier cell repeats a value', () => {
    const page = `
      <div data-qa="cell-text"><span data-qa="cell-text-content">Статус</span></div>
      <div data-qa="cell-text"><span data-qa="cell-text-content">Не&nbsp;указано</span></div>
      ${PROFILE_PAGE}
    `;

    expect(parseHhProfilePage(page).location).toBe('Казань');
  });

  it('says nothing when the page is not a profile page', () => {
    const identity = parseHhProfilePage('<div>Вход на hh.ru</div>');

    expect(identity.fullName).toBeUndefined();
    expect(identity.location).toBeUndefined();
    expect(identity.languages).toEqual([]);
  });
});

describe('merging the profile page into the resume', () => {
  it('fills only what the resume page left empty', () => {
    const merged = withHhProfileIdentity(resumePageOnly(), parseHhProfilePage(PROFILE_PAGE));

    expect(merged.fullName).toBe('Мария Иванова');
    expect(merged.contact.location).toBe('Казань');
    expect(merged.languages).toHaveLength(2);
    expect(merged.targetRole).toBe('Менеджер по продукту');
  });

  it('never overwrites what the resume page did state', () => {
    const stated: ParsedResume = {
      ...resumePageOnly(),
      fullName: 'Пётр Петров',
      contact: { email: 'candidate@example.test', location: 'Москва', links: [] },
      languages: [{ name: 'Немецкий' }],
    };

    const merged = withHhProfileIdentity(stated, parseHhProfilePage(PROFILE_PAGE));

    expect(merged.fullName).toBe('Пётр Петров');
    expect(merged.contact.location).toBe('Москва');
    expect(merged.languages).toEqual([{ name: 'Немецкий' }]);
  });

  /**
   * `rawText` is the whole message to the candidate API. A name that is not in
   * it is a name the profile never receives.
   */
  it('carries the merged identity into the text the server imports', () => {
    const merged = withHhProfileIdentity(resumePageOnly(), parseHhProfilePage(PROFILE_PAGE));

    expect(merged.rawText).toContain('Мария Иванова');
    expect(merged.rawText).toContain('Казань');
    expect(merged.rawText).toContain('Английский');
    expect(merged.rawText).toContain('Менеджер по продукту');
  });
});
