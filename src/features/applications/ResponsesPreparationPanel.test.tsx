// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { ResponsesPreparationPanel } from './ResponsesPreparationPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prepModal = vi.hoisted(() => vi.fn());
const storiesModal = vi.hoisted(() => vi.fn());

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

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  prepModal.mockClear();
  storiesModal.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('ResponsesPreparationPanel', () => {
  it('shows three sections with the story provenance and completeness', async () => {
    await render([interview('a1', 'Арка Холдинг', '2020-01-01T10:00:00Z')]);
    const headings = Array.from(host.querySelectorAll('h2')).map((node) => node.textContent);
    expect(headings).toEqual(['STAR на фактах профиля', 'Мок-интервью', 'Дебриф']);
    expect(host.textContent).toContain('заполнено 3 из 4');
    expect(host.textContent).toContain('подтверждено фактами профиля');
    expect(host.textContent).toContain('Арка Холдинг, VP Engineering');
  });

  it('opens the editor for exactly the clicked story', async () => {
    await render([]);
    await act(async () => button(/Править/).click());
    expect(storiesModal).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialEditStory: expect.objectContaining({ id: 's1' }) }),
    );
  });

  it('keeps the whole STAR list reachable', async () => {
    await render([]);
    await act(async () => button(/Открыть STAR-истории/).click());
    expect(storiesModal).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialEditStory: undefined }),
    );
  });

  it('passes the stress flag into the mock interview launch', async () => {
    await render([interview('a1', 'Арка Холдинг', null)]);
    const stress = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => stress.click());
    await act(async () => button(/Начать мок-интервью/).click());
    expect(prepModal).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialStressMode: true, startInMockInterview: true }),
    );
  });

  it('starts without stress mode by default', async () => {
    await render([interview('a1', 'Арка Холдинг', null)]);
    await act(async () => button(/Начать мок-интервью/).click());
    expect(prepModal).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialStressMode: false }),
    );
  });

  it('shows the response select only with more than one interview', async () => {
    await render([interview('a1', 'Арка Холдинг', null)]);
    expect(host.querySelector('select.career-select')).toBeNull();
    await render([interview('a1', 'Арка Холдинг', null), interview('a2', 'Вектор Банк', null)]);
    expect(host.querySelector('.career-select-wrap select.career-select')).not.toBeNull();
  });

  it('opens the debrief dialog from «Заполнить» and skips future interviews', async () => {
    const future = interview('a2', 'Будущее', '2999-01-01T10:00:00Z');
    await render([interview('a1', 'Вектор Банк', '2020-01-01T10:00:00Z'), future]);
    const fill = Array.from(host.querySelectorAll('button')).filter((node) =>
      /Заполнить/.test(node.textContent ?? ''),
    );
    expect(fill).toHaveLength(1);
    await act(async () => fill[0]!.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('shows the debrief empty state', async () => {
    await render([]);
    expect(host.textContent).toContain('Интервью, по которым нужен дебриф, пока нет.');
  });
});
