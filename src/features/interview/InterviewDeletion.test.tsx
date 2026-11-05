// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../coach/apiClient';
import { MockInterviewSimulator } from './MockInterviewSimulator';
import { StarStoriesModal } from './StarStoriesModal';
import {
  deleteInterviewSession,
  getCurrentInterviewSession,
  type InterviewSessionView,
} from './interviewSimulatorApi';
import { deleteStarStory, getStarStories } from './starStoriesApi';
import type { StarStoriesSnapshot } from '../../../shared/starStories';

vi.mock('./interviewSimulatorApi', async (original) => ({
  ...(await original<typeof import('./interviewSimulatorApi')>()),
  getCurrentInterviewSession: vi.fn(),
  deleteInterviewSession: vi.fn(),
}));
vi.mock('./starStoriesApi', async (original) => ({
  ...(await original<typeof import('./starStoriesApi')>()),
  getStarStories: vi.fn(),
  deleteStarStory: vi.fn(),
}));
vi.mock('../tariffs/TariffQuotaNote', () => ({ TariffQuotaNote: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SNAPSHOT = {
  facts: [],
  stories: [
    {
      id: 'story-1',
      title: 'Кризис в команде',
      version: 1,
      confidence: 'unconfirmed',
      sourceFactIds: [],
      sourceFacts: [],
      fields: { situation: 'С', task: 'З', action: 'Д', result: 'Р' },
      createdAt: '2026-11-05T10:00:00Z',
      updatedAt: '2026-11-05T10:00:00Z',
    },
  ],
} as unknown as StarStoriesSnapshot;

function session(status: InterviewSessionView['status']): InterviewSessionView {
  return {
    id: 'session-1',
    version: 3,
    status,
    mode: 'text',
    roleTitle: 'CTO',
    applicationId: 'app-1',
    vacancyTitle: 'CTO',
    questionTypes: ['behavioral'],
    stressMode: false,
    questions: [
      {
        id: 'q1',
        type: 'behavioral',
        topic: 'Тема',
        prompt: 'Вопрос',
        storyId: null,
        storyTitle: null,
        sourceFactIds: [],
        skipped: true,
      },
    ],
    currentQuestionIndex: 0,
    currentQuestion: null,
    topicSummary: [],
    startedAt: '2026-11-05T10:00:00Z',
    updatedAt: '2026-11-05T10:00:00Z',
  };
}

const notFound = () => new CoachApiError('не найдено', 'star_story_not_found', false);

let host: HTMLDivElement;
let root: Root;

const button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  );
const click = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`нет кнопки «${label}»`);
  await act(async () => target.click());
};

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(getStarStories).mockResolvedValue(SNAPSHOT);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('удаление STAR-истории', () => {
  const openModal = async () => {
    await act(async () => root.render(<StarStoriesModal isOpen onClose={vi.fn()} />));
  };
  const deleteLabel = 'Удалить историю «Кризис в команде»';

  it('спрашивает подтверждение, отмена ничего не удаляет', async () => {
    await openModal();
    await click(deleteLabel);
    expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('Кризис в команде');
    expect(deleteStarStory).not.toHaveBeenCalled();
    await click('Оставить');
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
    expect(document.body.textContent).toContain('Кризис в команде');
  });

  it('после подтверждения убирает историю из списка', async () => {
    vi.mocked(deleteStarStory).mockResolvedValue();
    await openModal();
    await click(deleteLabel);
    await click('Удалить историю');
    expect(deleteStarStory).toHaveBeenCalledWith('story-1');
    expect(document.body.textContent).toContain('Нет STAR-историй');
  });

  it('при сбое показывает ошибку и оставляет историю', async () => {
    vi.mocked(deleteStarStory).mockRejectedValue(new Error('сеть'));
    await openModal();
    await click(deleteLabel);
    await click('Удалить историю');
    expect(document.querySelector('[role=alertdialog] [role=alert]')?.textContent).toContain(
      'Не удалось удалить',
    );
    expect(document.body.textContent).toContain('Кризис в команде');
  });

  it('уже удалённая на другом устройстве история просто исчезает', async () => {
    vi.mocked(deleteStarStory).mockRejectedValue(notFound());
    await openModal();
    await click(deleteLabel);
    await click('Удалить историю');
    expect(document.body.textContent).toContain('Нет STAR-историй');
  });
});

describe('удаление тренировки', () => {
  const openSimulator = async (current: InterviewSessionView | null) => {
    vi.mocked(getCurrentInterviewSession).mockResolvedValue(current);
    await act(async () =>
      root.render(
        <MockInterviewSimulator
          vacancy={{ id: 'app-1', title: 'CTO', company: 'Маркет Софт' }}
          dialogRef={vi.fn()}
          onBackToPreparation={vi.fn()}
          onOpenStarStories={vi.fn()}
        />,
      ),
    );
  };

  it('на старте без сохранённой тренировки удалять нечего', async () => {
    await openSimulator(null);
    expect(document.body.textContent).toContain('их можно удалить');
    expect(button('Удалить тренировку')).toBeUndefined();
  });

  it('на старте с прерванной тренировкой удаление есть и спрашивает подтверждение', async () => {
    vi.mocked(deleteInterviewSession).mockResolvedValue();
    await openSimulator(session('interrupted'));
    await click('Удалить тренировку');
    expect(deleteInterviewSession).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('дневник');
    await click('Оставить');
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
    expect(deleteInterviewSession).not.toHaveBeenCalled();
  });

  it('с итога после подтверждения возвращает на старт без тренировки', async () => {
    vi.mocked(deleteInterviewSession).mockResolvedValue();
    await openSimulator(session('completed'));
    expect(document.body.textContent).toContain('Итог по темам');
    await click('Удалить тренировку');
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role=alertdialog] .career-interview-delete-go')
        ?.click();
    });
    expect(deleteInterviewSession).toHaveBeenCalledWith('session-1');
    expect(document.body.textContent).toContain('Как будем тренироваться');
    expect(document.body.textContent).not.toContain('Есть сохранённая тренировка');
    expect(button('Удалить тренировку')).toBeUndefined();
  });

  it('при сбое показывает ошибку и оставляет итог', async () => {
    vi.mocked(deleteInterviewSession).mockRejectedValue(new Error('сеть'));
    await openSimulator(session('completed'));
    await click('Удалить тренировку');
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role=alertdialog] .career-interview-delete-go')
        ?.click();
    });
    expect(document.querySelector('[role=alertdialog] [role=alert]')?.textContent).toContain(
      'Не удалось удалить',
    );
    expect(document.body.textContent).toContain('Итог по темам');
  });
});
