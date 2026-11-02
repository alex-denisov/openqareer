// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StarStoryView } from '../../../shared/starStories';
import type { ApplicationView } from '../applications/applicationsApi';
import { responseMockInterviewSuggestion } from '../applications/ResponseMockInterviewSuggestion';
import {
  applyLetterStarEdit,
  letterConsultantSuggestion,
  letterStarEdit,
} from '../vacancies/letterConsultantSuggestion';
import { ConsultantScreenSuggestionCard } from './ConsultantScreenSuggestionCard';
import {
  ConsultantSuggestionProvider,
  useConsultantScreenSuggestion,
  usePublishConsultantSuggestion,
  type ConsultantScreenSuggestion,
} from './consultantScreenSuggestion';

const NOW = Date.parse('2026-10-08T09:00:00Z');

function application(patch: Record<string, unknown>): ApplicationView {
  return {
    id: 'app-1',
    stage: 'interview',
    vacancy: { title: 'VP Engineering', company: 'Арка Холдинг', companyHidden: false },
    nearestInterview: { id: 'i1', scheduledAt: '2026-10-10T11:00:00Z', prepStatus: 'none' },
    ...patch,
  } as unknown as ApplicationView;
}

function story(patch: Partial<StarStoryView>): StarStoryView {
  return {
    id: 's1',
    version: 1,
    title: 'Кризис в команде',
    fields: {
      situation: 'с',
      task: 'з',
      action: 'д',
      result: 'провёл команду через уход ведущего инженера без срыва сроков',
    },
    sourceFactIds: ['f1'],
    confidence: 'confirmed',
    sourceFacts: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    ...patch,
  };
}

describe('mock interview suggestion (mockup 5)', () => {
  it('names the company and the real interview date, without a question count', () => {
    const suggestion = responseMockInterviewSuggestion(application({}), () => undefined, NOW);
    expect(suggestion?.title).toBe('Мок-интервью по Арка Холдинг');
    expect(suggestion?.detail).toMatch(/^Интервью 10\.10, \d\d:00, стресс-режим выключен\.$/);
    expect(suggestion?.detail).not.toMatch(/вопрос/);
    expect([suggestion?.acceptLabel, suggestion?.dismissLabel]).toEqual(['Начать', 'Не сейчас']);
  });

  it('keeps the generic state without an interview or after it has passed', () => {
    expect(
      responseMockInterviewSuggestion(application({ stage: 'applied' }), () => undefined, NOW),
    ).toBeNull();
    const passed = application({
      nearestInterview: { id: 'i1', scheduledAt: '2026-10-01T11:00:00Z' },
    });
    expect(responseMockInterviewSuggestion(passed, () => undefined, NOW)).toBeNull();
  });

  it('does not reveal a hidden company and says when the date is unknown', () => {
    const hidden = application({
      vacancy: { title: 'VP Engineering', company: 'Арка Холдинг', companyHidden: true },
      nearestInterview: null,
    });
    const suggestion = responseMockInterviewSuggestion(hidden, () => undefined, NOW);
    expect(suggestion?.title).toBe('Мок-интервью: VP Engineering');
    expect(suggestion?.detail).toBe('Дата интервью не указана, стресс-режим выключен.');
  });
});

describe('letter edit suggestion (mockup 9)', () => {
  const letter = 'Здравствуйте!\n\nСократил релиз с 14 до 3 дней.\n\nС уважением, Алексей';

  it('offers the result of a confirmed STAR story missing from the draft', () => {
    const edit = letterStarEdit(letter, [story({})]);
    expect(edit?.sentence).toBe('Провёл команду через уход ведущего инженера без срыва сроков.');
    const suggestion = letterConsultantSuggestion(edit!, () => undefined);
    expect(suggestion.title).toBe('Добавить фразу про «Кризис в команде»');
    expect(suggestion.detail).toContain('Источник: STAR-история, подтверждена фактами профиля.');
  });

  it('inserts the sentence as a paragraph before the sign-off', () => {
    const next = applyLetterStarEdit(letter, 'Провёл команду через кризис.');
    expect(next).toBe(
      'Здравствуйте!\n\nСократил релиз с 14 до 3 дней.\n\nПровёл команду через кризис.\n\nС уважением, Алексей',
    );
    expect(applyLetterStarEdit('Один абзац.', 'Ещё фраза.')).toBe('Один абзац. Ещё фраза.');
  });

  it('keeps the generic state for unconfirmed, already used or other-language results', () => {
    expect(letterStarEdit(letter, [story({ confidence: 'unconfirmed' })])).toBeNull();
    expect(
      letterStarEdit(letter, [
        story({ fields: { ...story({}).fields, result: 'сократил релиз с 14 до 3 дней' } }),
      ]),
    ).toBeNull();
    expect(letterStarEdit('Dear team,\n\nI cut releases.', [story({})])).toBeNull();
    expect(letterStarEdit('', [story({})])).toBeNull();
  });
});

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.innerHTML = '';
});

function Screen({ suggestion }: { readonly suggestion: ConsultantScreenSuggestion | null }) {
  usePublishConsultantSuggestion(suggestion);
  return null;
}

function Panel() {
  const { suggestion, dismiss } = useConsultantScreenSuggestion('responses');
  return suggestion ? (
    <ConsultantScreenSuggestionCard suggestion={suggestion} onDismiss={dismiss} />
  ) : (
    <p>Общие вопросы</p>
  );
}

async function mount(suggestion: ConsultantScreenSuggestion | null, showScreen = true) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (screen: boolean) =>
    root.render(
      <ConsultantSuggestionProvider>
        {screen ? <Screen suggestion={suggestion} /> : null}
        <Panel />
      </ConsultantSuggestionProvider>,
    );
  await act(async () => render(showScreen));
  return { host, rerender: (screen: boolean) => act(async () => render(screen)) };
}

function button(host: HTMLElement, label: string) {
  return [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!;
}

describe('panel suggestion slot', () => {
  it('shows the screen suggestion, runs «Начать» and then hides it', async () => {
    const onStart = vi.fn();
    const { host } = await mount(responseMockInterviewSuggestion(application({}), onStart, NOW));
    expect(host.textContent).toContain('Мок-интервью по Арка Холдинг');
    await act(async () => button(host, 'Начать').click());
    expect(onStart).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Общие вопросы');
  });

  it('«Не сейчас» dismisses without starting; leaving the screen restores the generic state', async () => {
    const onStart = vi.fn();
    const { host, rerender } = await mount(
      responseMockInterviewSuggestion(application({}), onStart, NOW),
    );
    await act(async () => button(host, 'Не сейчас').click());
    expect(onStart).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Общие вопросы');
    const other = await mount(
      responseMockInterviewSuggestion(application({ id: 'app-2' }), onStart, NOW),
    );
    expect(other.host.textContent).toContain('Мок-интервью');
    await other.rerender(false);
    expect(other.host.textContent).toContain('Общие вопросы');
    await rerender(false);
  });

  it('ignores suggestions published for another consultant stage', async () => {
    const letterOnly = letterConsultantSuggestion(
      letterStarEdit('Привет.', [story({})])!,
      () => undefined,
    );
    const { host } = await mount(letterOnly);
    expect(host.textContent).toContain('Общие вопросы');
  });
});
