import { describe, expect, it } from 'vitest';
import { englishJobTitle, letterEmployerName } from './letterLanguage';
import { letterFactsToTranslate } from './letterResults';
import { generateVacancyPitch, type VacancyPitchInputFact } from './vacancyPitchService';

// The prod profile of QA_CANDIDATE as the G3b walk saw it (03.11): Russian
// employers and titles, one confirmed outcome bullet under the oldest place,
// chronology records that are not results, an English vacancy.
const fact = (id: string, statement: string, domain: string): VacancyPitchInputFact => ({
  id,
  statement,
  kind: 'fact',
  domain,
  sourceMessageIds: ['m'],
  status: 'confirmed',
});
const OUTCOME = 'Склад и логистика для федеральной сети магазинов, команда выросла с 8 до 35 человек.';
const OUTCOME_EN = 'Built warehouse and logistics systems for a federal retail chain; the team grew from 8 to 35.';
const facts = [
  fact('exp-1', 'Маркет Софт, Санкт-Петербург — Директор по разработке — Финтех Лаб, Москва — Head of Engineering (2024-01 — наст. время)', 'role-evidence'),
  fact('exp-2', 'Ритейл Системс, Москва — Руководитель разработки — Маркет Софт (2021-02 — 2023-12)', 'role-evidence'),
  fact('exp-3', 'Специалист — Ритейл Системс, Москва — Руководитель разработки (2014-03 — 2021-01)', 'role-evidence'),
  fact('ach-3-1', OUTCOME, 'outcome'),
  fact('k8s', 'Kubernetes', 'skill'),
];
const workplaces = [
  { employer: 'Финтех Лаб', title: 'Head of Engineering', startDate: '2024-01', endDate: null, current: true, recordId: 'exp-1', evidenceIds: ['exp-1'] },
  { employer: 'Маркет Софт', title: 'Директор по разработке', startDate: '2021-02', endDate: '2023-12', current: false, recordId: 'exp-2', evidenceIds: ['exp-2'] },
  { employer: 'Ритейл Системс', title: 'Руководитель разработки', startDate: '2014-03', endDate: '2021-01', current: false, recordId: 'exp-3', evidenceIds: ['exp-3', 'ach-3-1'] },
];
const leidos = {
  id: 'v-leidos',
  title: 'Director, Technology Operations & Sustainment',
  company: 'Leidos',
  requiredSkills: ['Director-Of-Technology'],
};
const letter = (overrides: Partial<Parameters<typeof generateVacancyPitch>[0]> = {}) =>
  generateVacancyPitch({ vacancy: leidos, candidateName: 'Иван Петров', facts, workplaces, ...overrides });

describe('rule 1: results come from the confirmed facts of the workplaces', () => {
  it('asks to translate only the Russian result bullets of the places, outcome first, at most two', () => {
    const extra = [
      fact('ach-2-1', 'Руководил переходом на сервисную архитектуру в 3 командах', 'experience'),
      fact('ach-2-2', 'Сократил время релиза с 14 до 3 дней', 'outcome'),
    ];
    const places = [
      workplaces[0]!,
      { ...workplaces[1]!, evidenceIds: ['exp-2', 'ach-2-1', 'ach-2-2'] },
      workplaces[2]!,
    ];
    const wanted = letterFactsToTranslate([...facts, ...extra], places, 'en');
    expect(wanted.map((item) => item.id)).toEqual(['ach-2-2', 'ach-3-1']);
    expect(letterFactsToTranslate(facts, workplaces, 'ru')).toEqual([]);
  });

  it('puts the translated outcome into the experience paragraph of an English letter', () => {
    const pitch = letter({ translations: new Map([['ach-3-1', OUTCOME_EN]]) });
    expect(pitch.emailPitch.body).toContain('Among my results: built warehouse and logistics systems for a federal retail chain; the team grew from 8 to 35.');
    expect(pitch.atsCoverLetter).toContain('built warehouse and logistics systems for a federal retail chain; the team grew from 8 to 35.');
    expect(pitch.usedEvidenceIds).toContain('ach-3-1');
  });

  it('never quotes a workplace record as a result', () => {
    const pitch = letter({ translations: new Map([['ach-3-1', OUTCOME_EN], ['exp-1', 'Market Soft, St Petersburg']]) });
    expect(pitch.emailPitch.body).not.toContain('St Petersburg');
  });

  it('a Russian letter names the outcome first, in lower case after the colon', () => {
    const pitch = letter({ vacancy: { id: 'v', title: 'Директор по ИТ', company: 'Вектор' } });
    expect(pitch.emailPitch.body).toContain('Из результатов: команда выросла с 8 до 35 человек — склад и логистика для федеральной сети магазинов.');
    expect(pitch.emailPitch.body).not.toContain('Санкт-Петербург —');
  });

  it('without a translation the English letter has no result rather than a Russian one', () => {
    const pitch = letter();
    expect(pitch.emailPitch.body).not.toContain('Among my results');
    expect(pitch.emailPitch.body).not.toContain('Склад');
  });
});

describe('rule 2: employer names are kept as the candidate wrote them', () => {
  it('a Latin name stays as written, a Cyrillic one stays in its script inside quotes', () => {
    expect(letterEmployerName('Fintech Lab')).toBe('Fintech Lab');
    expect(letterEmployerName('Маркет Софт')).toBe('Маркет Софт');
    expect(letterEmployerName('"Ромашка"')).toBe('Ромашка');
    expect(letterEmployerName('«Ромашка»')).toBe('Ромашка');
  });

  it('the English letter never transliterates an employer', () => {
    const body = letter().emailPitch.body;
    expect(body).toContain('at Финтех Лаб (2024–present)');
    expect(body).not.toMatch(/Fintekh|Riteyl|Market Soft/u);
    const latin = letter({ workplaces: [{ ...workplaces[0]!, employer: 'Fintech Lab' }] });
    expect(latin.emailPitch.body).toContain('Head of Engineering at Fintech Lab (2024–present)');
  });
});

describe('rule 3: a workplace without a title reads without a dangling «at»', () => {
  it('uses the profile title when it can be translated', () => {
    expect(letter().emailPitch.body).toContain('Head of Engineering at Ритейл Системс (2014–2021)');
  });

  it('a place with no title says where the candidate worked', () => {
    const untitled = [workplaces[0]!, workplaces[1]!, { ...workplaces[2]!, title: null }];
    const body = letter({ workplaces: untitled }).emailPitch.body;
    expect(body).toContain(
      'before that, I was Director of Engineering at Маркет Софт (2021–2023) and worked at Ритейл Системс (2014–2021).',
    );
    expect(body).not.toMatch(/(?:that,|\),) at /u);
  });

  it('the current place without a title still reads as a sentence', () => {
    const body = letter({ workplaces: [{ ...workplaces[0]!, title: 'Специалист по чему-то' }] }).emailPitch.body;
    expect(body).toContain('I currently work at Финтех Лаб (2024–present).');
  });
});

describe('rule 4: titles are translated faithfully, never to a different level', () => {
  it.each([
    ['Директор по разработке', 'Director of Engineering'],
    ['Руководитель разработки', 'Head of Engineering'],
    ['Руководитель отдела разработки', 'Head of Engineering'],
    ['Технический директор', 'Chief Technology Officer'],
    ['Директор по информационным технологиям', 'Chief Information Officer'],
    ['Заместитель директора по ИТ', 'Deputy Director of IT'],
    ['Head of Engineering', 'Head of Engineering'],
  ])('%s → %s', (ru, en) => {
    expect(englishJobTitle(ru)).toBe(en);
  });

  it('an unknown title is left out instead of guessed', () => {
    expect(englishJobTitle('Специалист')).toBeNull();
    expect(englishJobTitle('Директор по чему-то')).toBeNull();
  });

  it('the Leidos letter names the real titles', () => {
    const body = letter().emailPitch.body;
    expect(body).toContain('I currently work as Head of Engineering at Финтех Лаб (2024–present)');
    expect(body).toContain('Director of Engineering at Маркет Софт (2021–2023)');
  });
});
