import { describe, expect, it } from 'vitest';
import {
  placeLanguages,
  pendingTranslation,
  applyBulletTranslation,
  textLanguage,
  BULLET_TRANSLATION_INSTRUCTIONS,
} from './experienceBulletLanguage';
import type { FactRewriteProposal, FactRewriteRequest } from './experienceFactRewrite';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './resumeDraft';

function place(id: string, title: string, bulletMemoryIds: string[] = []) {
  return {
    id,
    chronologyMemoryId: `chronology-${id}`,
    title,
    employer: 'Enterprise Public Cloud Platform',
    startDate: '2020-03',
    current: false,
    bulletMemoryIds,
  };
}

const statements = new Map([
  ['en-1', 'Drove CSAT from 23% to 68% and SLA compliance from 50% to 92%.'],
  ['en-2', 'Built proprietary cloud tooling from scratch: statuspage and knowledge base.'],
  ['ru-1', 'Сократил время решения инцидентов на 40% за счёт координации линий поддержки.'],
  ['ru-2', 'Построил ИТ-инфраструктуру с нуля: домен, телефония, виртуализация серверов.'],
]);

describe('textLanguage', () => {
  it('tells English from Russian by the letters, ignoring Latin terms in Russian text', () => {
    expect(textLanguage('Reduced incident resolution time by 40%.')).toBe('en');
    expect(textLanguage('Внедрил контроль качества по SLA, RTO, RPO и жалобам.')).toBe('ru');
    expect(textLanguage('SLA')).toBeUndefined();
    expect(textLanguage('')).toBeUndefined();
  });
});

describe('placeLanguages', () => {
  it('an English profile writes every place in English', () => {
    const draft: ResumeDraft = {
      ...EMPTY_RESUME_DRAFT,
      candidate: { about: 'I build and scale technology organizations that drive revenue.' },
      experience: [place('a', 'Head of Technical Support', ['en-1']), place('b', 'IT Lead')],
    };
    expect(placeLanguages(draft, statements)).toEqual(
      new Map([
        ['a', 'en'],
        ['b', 'en'],
      ]),
    );
  });

  it('a Russian profile writes every place in Russian', () => {
    const draft: ResumeDraft = {
      ...EMPTY_RESUME_DRAFT,
      candidate: { about: 'Строю и масштабирую технологические подразделения.' },
      experience: [place('a', 'Руководитель поддержки', ['ru-1']), place('b', 'ИТ-директор')],
    };
    expect(placeLanguages(draft, statements)).toEqual(
      new Map([
        ['a', 'ru'],
        ['b', 'ru'],
      ]),
    );
  });

  it('a mixed profile follows each experience entry', () => {
    const draft: ResumeDraft = {
      ...EMPTY_RESUME_DRAFT,
      experience: [
        place('a', 'Head of Technical Support', ['en-1', 'en-2']),
        place('b', 'Руководитель ИТ', ['ru-1', 'ru-2']),
      ],
    };
    expect(placeLanguages(draft, statements)).toEqual(
      new Map([
        ['a', 'en'],
        ['b', 'ru'],
      ]),
    );
  });

  it('a profile with no text of its own stays Russian, as before', () => {
    const draft: ResumeDraft = { ...EMPTY_RESUME_DRAFT, experience: [place('a', '')] };
    expect(placeLanguages(draft, statements).get('a')).toBe('ru');
  });
});

const request: FactRewriteRequest = {
  places: [
    {
      experienceId: 'cloud',
      employer: 'Enterprise Public Cloud Platform',
      title: 'Head of Technical Support',
      period: '2020-03 — 2023-04',
      existingBullets: [],
      language: 'en',
    },
  ],
  facts: [
    { id: 'f-team', domain: 'outcome', statement: 'Команда расширилась с четырех до одиннадцати' },
    { id: 'f-load', domain: 'responsibility', statement: 'следил за нагрузкой каждого сотрудника' },
    { id: 'f-247', domain: 'outcome', statement: 'внедрили круглосуточный режим через полгода' },
  ],
};

const russianProposal: FactRewriteProposal = {
  id: 'p-1',
  places: [
    {
      experienceId: 'cloud',
      bullets: [
        {
          text: 'Расширил команду с 4 до 11 человек, контролируя нагрузку каждого инженера.',
          sourceFactIds: ['f-team', 'f-load'],
        },
        { text: 'Внедрил круглосуточный режим поддержки через полгода.', sourceFactIds: ['f-247'] },
      ],
    },
  ],
  leftOutFactIds: [],
  sourceFactIds: ['f-team', 'f-load', 'f-247'],
};

describe('pendingTranslation', () => {
  it('asks to translate the Russian bullets of an English place, with their facts', () => {
    const pending = pendingTranslation(russianProposal, request);
    expect(pending?.bullets).toEqual([
      {
        key: 'cloud#0',
        language: 'en',
        text: russianProposal.places[0]!.bullets[0]!.text,
        facts: [
          'Команда расширилась с четырех до одиннадцати',
          'следил за нагрузкой каждого сотрудника',
        ],
      },
      {
        key: 'cloud#1',
        language: 'en',
        text: russianProposal.places[0]!.bullets[1]!.text,
        facts: ['внедрили круглосуточный режим через полгода'],
      },
    ]);
  });

  it('leaves a proposal already in the place language alone', () => {
    const russian = { ...request, places: [{ ...request.places[0]!, language: 'ru' as const }] };
    expect(pendingTranslation(russianProposal, russian)).toBeNull();
  });

  it('tells the translator never to make a claim stronger than its facts', () => {
    expect(BULLET_TRANSLATION_INSTRUCTIONS).toContain('Не усиливай');
    expect(BULLET_TRANSLATION_INSTRUCTIONS).toContain('round-the-clock');
  });
});

describe('applyBulletTranslation', () => {
  const pending = pendingTranslation(russianProposal, request)!;

  it('replaces the text, keeps every source fact and gives the proposal a new id', () => {
    const translated = applyBulletTranslation(
      russianProposal,
      pending,
      {
        bullets: [
          {
            key: 'cloud#0',
            text: 'Grew the team from 4 to 11 people, tracking the workload of each engineer',
          },
          { key: 'cloud#1', text: 'Introduced round-the-clock support within six months.' },
        ],
      },
      'p-2',
    );
    expect(translated).toEqual({
      ...russianProposal,
      id: 'p-2',
      places: [
        {
          experienceId: 'cloud',
          bullets: [
            {
              text: 'Grew the team from 4 to 11 people, tracking the workload of each engineer.',
              sourceFactIds: ['f-team', 'f-load'],
            },
            {
              text: 'Introduced round-the-clock support within six months.',
              sourceFactIds: ['f-247'],
            },
          ],
        },
      ],
    });
  });

  it('refuses the whole translation when a bullet is missing, untranslated or adds a number', () => {
    const good = { key: 'cloud#1', text: 'Introduced round-the-clock support within six months.' };
    const cases = [
      [good],
      [{ key: 'cloud#0', text: russianProposal.places[0]!.bullets[0]!.text }, good],
      [{ key: 'cloud#0', text: 'Grew the team from 4 to 11 people in 2 years.' }, good],
      [{ key: 'cloud#0', text: 'We grew the team from 4 to 11 people.' }, good],
    ];
    for (const bullets of cases) {
      expect(applyBulletTranslation(russianProposal, pending, { bullets }, 'p-2')).toBeNull();
    }
  });
});
