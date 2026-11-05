// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockInterviewSimulator } from './MockInterviewSimulator';
import {
  getCurrentInterviewSession,
  type InterviewQuestionView,
  type InterviewSessionView,
} from './interviewSimulatorApi';
import { getStarStories } from './starStoriesApi';

vi.mock('./interviewSimulatorApi', async (original) => ({
  ...(await original<typeof import('./interviewSimulatorApi')>()),
  getCurrentInterviewSession: vi.fn(),
}));
vi.mock('./starStoriesApi', async (original) => ({
  ...(await original<typeof import('./starStoriesApi')>()),
  getStarStories: vi.fn(),
}));
vi.mock('../tariffs/TariffQuotaNote', () => ({ TariffQuotaNote: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION: InterviewQuestionView = {
  id: 'q1',
  type: 'behavioral',
  topic: 'Тема',
  prompt: 'Расскажите про ситуацию',
  storyId: null,
  storyTitle: null,
  sourceFactIds: [],
  skipped: false,
};

function session(
  status: InterviewSessionView['status'],
  question: InterviewQuestionView = QUESTION,
  mode: InterviewSessionView['mode'] = 'voice',
): InterviewSessionView {
  return {
    id: 'session-1',
    version: 3,
    status,
    mode,
    roleTitle: 'CTO',
    applicationId: 'app-1',
    vacancyTitle: 'CTO',
    questionTypes: ['behavioral'],
    stressMode: false,
    questions: [question],
    currentQuestionIndex: 0,
    currentQuestion: question,
    topicSummary: [],
    startedAt: '2026-11-05T10:00:00Z',
    updatedAt: '2026-11-05T10:00:00Z',
  };
}

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    FakeRecognition.last = this;
  }
  stop() {
    this.onend?.();
  }
  abort() {}
  say(text: string) {
    this.onresult?.({ results: { length: 1, 0: { 0: { transcript: text } } } });
  }
}

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

async function open(current: InterviewSessionView) {
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
}

async function openRecording() {
  await open(session('active'));
  await click('Продолжить с вопроса 1');
  await click('Начать запись');
}

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(getStarStories).mockResolvedValue({ facts: [], stories: [] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('экран голоса по макету 14', () => {
  it('до записи волны нет, кнопка называется «Начать запись»', async () => {
    await open(session('active'));
    await click('Продолжить с вопроса 1');
    expect(document.querySelector('.career-mock-wave')).toBeNull();
    expect(button('Начать запись')).toBeDefined();
    expect(button('Начать заново')).toBeUndefined();
  });

  it('во время записи волна и «Начать заново», остановить запись всё равно можно', async () => {
    await openRecording();
    expect(document.querySelector('.career-mock-wave')).not.toBeNull();
    expect(button('Начать заново')).toBeDefined();
    await act(async () => FakeRecognition.last?.say('Первым делом собрал команду'));
    await click('Остановить запись');
    expect(document.querySelector('.career-mock-wave')).toBeNull();
    expect(document.body.textContent).toContain('Первым делом собрал команду');
    expect(document.body.textContent).toContain('Запись остановлена');
  });

  it('«Начать заново» стирает распознанное и пишет снова', async () => {
    await openRecording();
    await act(async () => FakeRecognition.last?.say('Первая попытка'));
    await click('Начать заново');
    expect(document.body.textContent).not.toContain('Первая попытка');
    expect(document.querySelector('.career-mock-wave')).not.toBeNull();
  });

  it('390: корзина отменяет запись и открывает ввод текста пустым', async () => {
    await openRecording();
    await act(async () => FakeRecognition.last?.say('Лишний текст'));
    await click('Отменить запись');
    expect(document.querySelector('textarea')?.value).toBe('');
    expect(document.body.textContent).not.toContain('Лишний текст');
  });

  it('390: кнопка отправки голосом без текста недоступна', async () => {
    await openRecording();
    expect(button('Отправить голосом')?.disabled).toBe(true);
    await act(async () => FakeRecognition.last?.say('Готовый ответ'));
    expect(button('Отправить голосом')?.disabled).toBe(false);
  });
});

describe('дневник уходит с разбора на итог', () => {
  const answered: InterviewQuestionView = {
    ...QUESTION,
    answer: {
      text: 'Ответ',
      elapsedSeconds: 10,
      evaluation: { rubric: 'star', criteria: {}, points: 0, maxPoints: 8 },
    },
  };

  it('на разборе «Записать в дневник» нет', async () => {
    await open(session('active', answered, 'text'));
    await click('Продолжить с вопроса 1');
    expect(document.body.textContent).toContain('Следующий вопрос');
    expect(button('Записать в дневник')).toBeUndefined();
  });

  it('390: итог показывает «Завершено», статус темы со значком, подпись без повтора заголовка', async () => {
    await open({
      ...session('completed', answered, 'text'),
      topicSummary: [{ topic: 'behavioral', answered: 1, points: 2, maxPoints: 4 }],
    });
    expect(document.querySelector('.career-mock-result-status')?.textContent).toContain('Завершено');
    expect(document.querySelector('.career-mock-status .career-mock-status-icon')).not.toBeNull();
    expect(document.querySelector('.career-mock-mobile-hero p')?.textContent).not.toContain(
      'Мок-интервью завершено',
    );
  });

  it('390: разбор по макету: подпись с номером вопроса, подпись «Критерии», значок статуса, строки', async () => {
    await open(session('active', answered, 'text'));
    await click('Продолжить с вопроса 1');
    expect(document.querySelector('.career-mock-mobile-hero p')?.textContent).toMatch(
      /^Вопрос 1 из \d+ · оценка/u,
    );
    expect(document.querySelector('.career-mock-criteria-cap')?.textContent).toBe('Критерии');
    expect(button('Следующий вопрос')?.classList).toContain('career-mock-result-again');
    expect(button('Ответить ещё раз')?.closest('.career-mock-result-rows')).not.toBeNull();
  });

  it('на итоге «Записать в дневник» есть', async () => {
    await open(session('completed', answered, 'text'));
    expect(button('Записать в дневник')).toBeDefined();
    expect(button('Пройти заново')).toBeDefined();
  });
});
