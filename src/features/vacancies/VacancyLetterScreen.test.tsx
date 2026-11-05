import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LetterScreenState } from './vacancyLetterController';
import { VacancyLetterScreen, type VacancyLetterTarget } from './VacancyLetterScreen';
import { factsLabel, LetterNotices, workplaceRange } from './VacancyLetterEditor';
import type { VacancyPitchResult } from './vacancyPitchApi';
import { CandidateDisplayNameContext } from '../shell/candidateDisplayName';

const state: { current: LetterScreenState } = { current: undefined as never };
vi.mock('./vacancyLetterController', () => ({
  useVacancyLetterController: () => state.current,
}));
vi.mock('../tariffs/TariffQuotaNote', () => ({ TariffQuotaNote: () => null }));

const person = { id: 'p1', fullName: 'Мария Орлова', roleTitle: 'рекрутер', companyName: 'Вектор' };
const path = {
  id: 'path-1',
  circle: 1,
  strength: 'direct',
  evidence: ['писала вам 28.09'],
  path: [person],
  recipient: person,
};
const vacancy: VacancyLetterTarget = {
  id: 'v1',
  canonicalTitle: 'Head of Platform',
  canonicalCompany: 'Вектор Банк',
  sources: [{ sourceName: 'hh.ru' }],
  descriptionSummary: 'Описание',
  primaryUrl: '',
};

function makeState(overrides: Partial<LetterScreenState['draft']> = {}): LetterScreenState {
  const circle1 = { circle: 1, state: 'available', paths: [path], message: '' };
  return {
    circles: { data: { circles: [circle1] }, loading: false, error: '', retry: vi.fn() },
    circle: {
      circle: 1,
      setCircle: vi.fn(),
      selectedPathId: null,
      setSelectedPathId: vi.fn(),
      selectedPath: path,
      result: circle1,
    },
    tone: 'executive',
    language: 'ru',
    setTone: vi.fn(),
    setLanguage: vi.fn(),
    draft: {
      pitch: {
        vacancyId: 'v1',
        emailPitch: { subject: 's', body: 'b' },
        linkedInNote: '',
        atsCoverLetter: '',
        usedEvidenceIds: ['e1'],
        notices: ['Требование про Kafka не подтверждено профилем.'],
      },
      workplaces: [
        {
          id: 'w1',
          employer: 'Финтех Лаб',
          title: 'Head of Engineering',
          startDate: '2021-03',
          endDate: null,
          current: true,
          evidenceIds: ['e1', 'e2'],
        },
      ],
      text: 'Мария, добрый день! Готов продолжить разговор.',
      setText: vi.fn(),
      loading: false,
      error: '',
      retry: vi.fn(),
      includedIds: ['w1'],
      excludedEvidenceIds: [],
      toggle: vi.fn(),
      ...overrides,
    },
    approval: { saved: null, busy: false, error: '', approve: vi.fn(), reset: vi.fn() },
  } as unknown as LetterScreenState;
}

function html(extra: { onOpenResume?: () => void } = {}): string {
  state.current = makeState();
  return renderToStaticMarkup(
    <CandidateDisplayNameContext.Provider value="Андрей Лебедев">
      <VacancyLetterScreen vacancy={vacancy} onBack={vi.fn()} onOpenExpert={vi.fn()} {...extra} />
    </CandidateDisplayNameContext.Provider>,
  );
}

describe('VacancyLetterScreen (mockup 9)', () => {
  it('has no separate page title; the section and the circle cards come first', () => {
    const markup = html();
    expect(markup).not.toContain('Письмо под вакансию');
    expect(markup).toContain('Как откликнуться: три круга связей');
    expect(markup).toContain('aria-label="Назад к вакансиям"');
    expect(markup).toContain('Круг 3');
    expect(markup).toContain('aria-label="Пояснение"');
  });

  it('keeps everything about one circle in one card', () => {
    const markup = html();
    const card = markup.slice(markup.indexOf('career-letter-card"'));
    expect(card).toContain('Черновик, ничего не отправлено');
    expect(card).toContain('Кому: Мария Орлова');
    expect(card).toContain('Куда и что отправим');
    expect(card).toContain('Текст письма');
    expect(card).toContain('Одобрить письмо');
    expect(card).toContain('Попросить правки');
    expect(card).not.toContain('Попросить правки у консультанта');
  });

  it('writes one meta line and keeps the server notices inside the card', () => {
    const markup = html();
    expect(markup).toMatch(/<span>6(<!-- -->)? слов<\/span>/u);
    expect(markup).toContain('Длина подобрана под канал: сообщение знакомому');
    expect(markup).toContain('От имени: Андрей Лебедев');
    expect(markup).not.toContain('опирается только на выбранные факты');
    expect(markup).toContain('Требование про Kafka не подтверждено профилем.');
  });

  it('shows workplaces as one line with the real fact count', () => {
    const markup = html();
    // Решение CPO: места отмечает правило «есть подтверждённые факты», а не консультант и не вакансия.
    expect(markup).toContain('Отмечены места с фактами');
    expect(markup).not.toContain('Предложено консультантом');
    expect(markup).toContain('Head of Engineering, 2021 — сейчас');
    expect(markup).toContain('Для письма доступно: 2 подтверждённых факта из этого места');
    expect(markup).not.toContain('2 факта<');
  });

  it('offers «Открыть» for the resume only when the host gives a way to', () => {
    expect(html()).not.toContain('>Открыть<');
    expect(html({ onOpenResume: vi.fn() })).toContain('>Открыть<');
  });
});

describe('the note under the letter (G3 L2)', () => {
  const pitch = (extra: Partial<VacancyPitchResult>): VacancyPitchResult => ({
    vacancyId: 'v1',
    emailPitch: { subject: 's', body: 'b' },
    linkedInNote: '',
    atsCoverLetter: '',
    usedEvidenceIds: ['e1'],
    language: 'en',
    generatedAt: '2026-11-03T00:00:00.000Z',
    ...extra,
  });
  const notes = (extra: Partial<VacancyPitchResult>) =>
    renderToStaticMarkup(<LetterNotices pitch={pitch(extra)} />);

  it('shows nothing for a clean English letter — no language banner', () => {
    expect(notes({})).toBe('');
  });

  it('a model letter shows its note, not the few-facts line the template would have earned', () => {
    const markup = notes({
      bodySource: 'model',
      usedEvidenceIds: [],
      notices: ['Черновик написала модель. Прочитайте его перед отправкой.'],
    });
    expect(markup).toContain('Черновик написала модель');
    expect(markup).not.toContain('мало подтверждённых');
  });

  it('shows one line even when the server sends several', () => {
    const markup = notes({
      notices: ['Первая.', 'Вторая.'],
      unconfirmedRequirements: ['IT director'],
    });
    expect(markup).toContain('Первая.');
    expect(markup).not.toContain('Вторая.');
    expect(markup).not.toContain('IT director');
  });

  it('counts unconfirmed requirements and lists their human labels on demand', () => {
    const markup = notes({
      language: 'ru',
      unconfirmedRequirements: ['Director of technology', 'Technology director'],
    });
    expect(markup).toContain(
      '<summary>2 требования вакансии не подтверждены фактами профиля</summary>',
    );
    expect(markup).toContain('<li>Director of technology</li>');
    expect(markup).not.toMatch(/\p{L}+-\p{Lu}\p{Ll}+/u);
    expect(notes({ language: 'ru', unconfirmedRequirements: ['Kafka'] })).toContain(
      '1 требование вакансии не подтверждено',
    );
  });

  it('the note under an English letter is in English', () => {
    expect(notes({ unconfirmedRequirements: ['Kafka', 'Go'] })).toContain('2 vacancy requirements are not confirmed');
    expect(notes({ unconfirmedRequirements: ['Kafka'] })).toContain('1 vacancy requirement is not confirmed');
    const fewFacts = notes({ usedEvidenceIds: [] });
    expect(fewFacts).toContain('too few confirmed facts');
    expect(fewFacts).not.toContain('мало подтверждённых');
  });
});

describe('letter helpers', () => {
  it('declines facts and prints years only', () => {
    expect(factsLabel(1)).toBe('1 подтверждённый факт');
    expect(factsLabel(3)).toBe('3 подтверждённых факта');
    expect(factsLabel(11)).toBe('11 подтверждённых фактов');
    expect(
      workplaceRange({
        id: 'a',
        employer: null,
        title: null,
        startDate: '2014-05-01',
        endDate: '2017',
        current: false,
        evidenceIds: [],
      }),
    ).toBe('2014 — 2017');
  });

  it('names the board, not how the source is read (Д2)', () => {
    state.current = makeState();
    const markup = renderToStaticMarkup(
      <CandidateDisplayNameContext.Provider value={null}>
        <VacancyLetterScreen
          vacancy={{ ...vacancy, sources: [{ sourceName: 'Himalayas (JSON API)' }, { sourceName: 'Himalayas' }] }}
          onBack={vi.fn()}
        />
      </CandidateDisplayNameContext.Provider>,
    );
    expect(markup).toContain('· Himalayas</p>');
    expect(markup).not.toContain('JSON API');
  });
});
