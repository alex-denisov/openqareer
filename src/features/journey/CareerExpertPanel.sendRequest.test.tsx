// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coach = vi.hoisted(() => ({
  sendCoachTurn: vi.fn(),
  getCandidateWithMessages: vi.fn(),
}));
vi.mock('../coach/coachApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../coach/coachApi')>()),
  sendCoachTurn: coach.sendCoachTurn,
  getCandidateWithMessages: coach.getCandidateWithMessages,
}));

import { CareerExpertPanel } from './CareerExpertPanel';

const USER = { username: 'synthetic', candidateId: 'candidate-g5', role: 'candidate' } as never;
const PROMPT = 'Почему «Вектор Банк» подходит? Разбери вакансию «Head of Engineering».';

describe('CareerExpertPanel sendRequest (G5 A2)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    coach.getCandidateWithMessages.mockResolvedValue({ messages: [], turns: [] });
    // The reply never lands here: the test checks only what was sent.
    coach.sendCoachTurn.mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function render(sendRequest?: number) {
    root.render(
      <CareerExpertPanel
        stage="vacancies"
        subject={{ kind: 'vacancy', id: 'vac-1' }}
        initialPrompt={PROMPT}
        sendRequest={sendRequest}
        initialUser={USER}
        onClose={() => undefined}
      />,
    );
  }

  it('sends the vacancy question at once, once per request', async () => {
    await act(async () => render(1));
    expect(coach.sendCoachTurn).toHaveBeenCalledTimes(1);
    expect(container.querySelector('textarea')?.value).toBe('');
    expect(coach.sendCoachTurn.mock.calls[0]?.[0]).toMatchObject({
      content: PROMPT,
      stage: 'vacancies',
      subject: { kind: 'vacancy', id: 'vac-1' },
    });
    await act(async () => render(1));
    expect(coach.sendCoachTurn).toHaveBeenCalledTimes(1);
    await act(async () => render(2));
    expect(coach.sendCoachTurn).toHaveBeenCalledTimes(2);
  });

  it('only fills the input without a request', async () => {
    await act(async () => render(undefined));
    expect(coach.sendCoachTurn).not.toHaveBeenCalled();
    expect(container.querySelector('textarea')?.value).toBe(PROMPT);
  });
});
