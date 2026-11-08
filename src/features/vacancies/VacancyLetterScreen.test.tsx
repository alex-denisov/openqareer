import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LetterScreenState } from './vacancyLetterController';
import { VacancyLetterScreen, type VacancyLetterTarget } from './VacancyLetterScreen';
import { LetterNotices, wordCountLabel } from './VacancyLetterEditor';
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
    expect(card).toContain('Кому: Мария О., Вектор');
    expect(card).toContain('Куда и что отправим');
    expect(card).toContain('Текст письма');
    expect(card).toContain('Одобрить письмо');
    expect(card).toContain('Попросить правки');
    expect(card).not.toContain('Попросить правки у консультанта');
  });

  it('says the letter is from the name it is signed with, not the account name', () => {
    state.current = makeState();
    const base = state.current as unknown as { draft: { pitch: object } };
    state.current = {
      ...state.current,
      draft: { ...base.draft, pitch: { ...base.draft.pitch, senderName: 'Андрей Лебедев' } },
    } as unknown as LetterScreenState;
    const markup = renderToStaticMarkup(
      <CandidateDisplayNameContext.Provider value="QA Пилот">
        <VacancyLetterScreen vacancy={vacancy} onBack={vi.fn()} onOpenExpert={vi.fn()} />
      </CandidateDisplayNameContext.Provider>,
    );
    expect(markup).toContain('От имени: Андрей Лебедев');
    expect(markup).not.toContain('QA Пилот');
  });

  it('writes one meta line and keeps the server notices inside the card', () => {
    const markup = html();
    expect(markup).toContain('<span>6 слов</span>');
    expect(markup).toContain('Длина подобрана под канал: сообщение знакомому');
    expect(markup).toContain('От имени: Андрей Лебедев');
    expect(markup).not.toContain('опирается только на выбранные факты');
    expect(markup).toContain('Требование про Kafka не подтверждено профилем.');
  });

  it('does not offer a choice of workplaces: the letter uses the whole profile (B618)', () => {
    const markup = html();
    expect(markup).not.toContain('Места работы в письме');
    expect(markup).not.toContain('Отмечены места с фактами');
    expect(markup).not.toContain('career-letter-workplaces');
    expect(markup).not.toContain('type="checkbox"');
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

  it('a model letter shows its fact warning, not the few-facts line the template would have earned', () => {
    const markup = notes({
      bodySource: 'model',
      usedEvidenceIds: [],
      notices: ['Перед отправкой сверьте с профилем 1 утверждение: «команда выросла с 8 до 35 человек».'],
    });
    expect(markup).toContain('сверьте с профилем');
    expect(markup).not.toContain('мало подтверждённых');
  });

  it('08.11: письмо модели без примечаний не рисует пустой блок под письмом', () => {
    expect(notes({ bodySource: 'model', usedEvidenceIds: [], notices: [] })).toBe('');
  });

  it('круги 1 и 2 показывают короткое сообщение, а не письмо модели: предупреждения о письме там нет', () => {
    const modelNote = ['Перед отправкой сверьте с профилем 1 утверждение: «команда выросла с 8 до 35 человек».'];
    const markup = renderToStaticMarkup(
      <LetterNotices circle={1} pitch={pitch({ bodySource: 'model', notices: modelNote })} />,
    );
    expect(markup).not.toContain('сверьте с профилем');
    expect(
      renderToStaticMarkup(<LetterNotices circle={3} pitch={pitch({ bodySource: 'model', notices: modelNote })} />),
    ).toContain('сверьте с профилем');
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

  it('the requirements note stays in Russian under an English letter: the candidate reads it', () => {
    expect(notes({ unconfirmedRequirements: ['Kafka', 'Go'] })).toContain(
      '2 требования вакансии не подтверждены',
    );
    expect(notes({ unconfirmedRequirements: ['Kafka'] })).toContain(
      '1 требование вакансии не подтверждено',
    );
    const fewFacts = notes({ usedEvidenceIds: [] });
    expect(fewFacts).toContain('too few confirmed facts');
    expect(fewFacts).not.toContain('мало подтверждённых');
  });
});

describe('letter word counter', () => {
  it.each([
    [1, '1 слово'],
    [2, '2 слова'],
    [5, '5 слов'],
    [11, '11 слов'],
    [21, '21 слово'],
    [94, '94 слова'],
  ])('declines %i', (count, label) => {
    expect(wordCountLabel(count)).toBe(label);
  });
});

