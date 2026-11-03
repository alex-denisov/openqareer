// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { ResponsesPreparationPanel } from './ResponsesPreparationPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prepModal = vi.hoisted(() => vi.fn());
const storiesModal = vi.hoisted(() => vi.fn());
const patchInterview = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../interview/InterviewPrepModal', () => ({
  InterviewPrepModal: (props: Record<string, unknown>) => {
    prepModal(props);
    return <div data-testid="prep-modal" />;
  },
}));
vi.mock('../interview/StarStoriesModal', () => ({
  StarStoriesModal: (props: Record<string, unknown>) => {
    storiesModal(props);
    return <div data-testid="stories-modal" />;
  },
}));
vi.mock('./applicationsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./applicationsApi')>()),
  patchApplicationInterview: patchInterview,
}));
vi.mock('../interview/starStoriesApi', () => ({
  getStarStories: vi.fn(async () => ({
    facts: [],
    stories: [
      {
        id: 's1',
        version: 1,
        title: 'Релиз с 14 до 3 дней',
        fields: { situation: 'a', task: 'b', action: 'c', result: '' },
        sourceFactIds: ['f1'],
        sourceFacts: [{ id: 'f1', statement: 'x', domain: 'experience', createdAt: '' }],
        confidence: 'confirmed',
        createdAt: '',
        updatedAt: '',
      },
    ],
  })),
}));

function interview(id: string, company: string, scheduledAt: string | null): ApplicationView {
  return {
    id,
    stage: 'interview',
    version: 1,
    followUpDueAt: null,
    vacancy: { title: 'VP Engineering', company, source: 'hh', companyHidden: false },
    materials: { resume: true, coverLetter: false },
    nearestInterview: { id: `i-${id}`, scheduledAt, prepStatus: 'none', round: 1 },
  } as unknown as ApplicationView;
}

const TWO = [
  interview('a1', 'Арка Холдинг', '2020-01-01T10:00:00Z'),
  interview('a2', 'Вектор Банк', null),
];

let host: HTMLDivElement;
let root: Root;

async function render(applications: readonly ApplicationView[]) {
  await act(async () => {
    root.render(<ResponsesPreparationPanel applications={applications} onRefresh={vi.fn()} />);
  });
}

function button(name: RegExp): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find((node) =>
    name.test(node.getAttribute('aria-label') ?? node.textContent ?? ''),
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

async function click(name: RegExp) {
  await act(async () => button(name).click());
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  prepModal.mockClear();
  storiesModal.mockClear();
  patchInterview.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('ResponsesPreparationPanel at 390 (B511 G3 item 8)', () => {
  it('lists row-links without the response select, the stress box or «Заполнить»', async () => {
    await render(TWO);
    const headings = Array.from(host.querySelectorAll('h2')).map((node) => node.textContent);
    expect(headings).toEqual(['STAR на фактах профиля', 'Мок-интервью', 'Дебриф']);
    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.textContent).not.toContain('Заполнить');
    expect(button(/Мок-интервью: Вектор Банк/)).toBeTruthy();
    expect(host.textContent).toContain('3 из 4 · подтверждено фактами профиля');
  });

  it('pushes the story screen with its structure and opens the editor on it', async () => {
    await render(TWO);
    await click(/Открыть историю: Релиз/);
    const push = host.querySelector('[aria-labelledby]')!;
    expect(push.querySelector('h2')?.textContent).toBe('Подготовка');
    expect(host.querySelector('[data-mobile-push="story"]')).not.toBeNull();
    const pairs = Array.from(host.querySelectorAll('dl div')).map((node) => node.textContent);
    expect(pairs).toEqual([
      'СитуацияЗаполнено',
      'ЗадачаЗаполнено',
      'ДействиеЗаполнено',
      'РезультатНе заполнено',
    ]);
    await click(/Править: Релиз/);
    expect(storiesModal).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialEditStory: expect.objectContaining({ id: 's1' }) }),
    );
    await click(/Назад/);
    expect(host.querySelector('[data-mobile-push]')).toBeNull();
  });

  it('chooses the response by its row and takes the stress mode on the mock screen', async () => {
    await render(TWO);
    await click(/Мок-интервью: Вектор Банк/);
    const stress = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => stress.click());
    await click(/Начать мок-интервью/);
    expect(prepModal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialStressMode: true,
        vacancy: expect.objectContaining({ company: 'Вектор Банк' }),
      }),
    );
  });

  it('starts the first interview from the tab CTA without stress', async () => {
    await render(TWO);
    await click(/Начать мок-интервью/);
    expect(prepModal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialStressMode: false,
        vacancy: expect.objectContaining({ company: 'Арка Холдинг' }),
      }),
    );
  });

  it('lays the debrief form on its screen and saves it to the interview', async () => {
    await render(TWO);
    await click(/Дебриф: Арка Холдинг/);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('form.career-debrief-form')).not.toBeNull();
    await act(async () => {
      host.querySelector('form')!.requestSubmit();
    });
    expect(patchInterview).toHaveBeenCalledWith('a1', 'i-a1', expect.anything());
    expect(host.querySelector('[data-mobile-push]')).toBeNull();
  });
});
