// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../kit/testDom';
import type { ApplyHead } from '../model/applyModel';

const api = vi.hoisted(() => ({
  getHhResumes: vi.fn(),
  saveHhResumes: vi.fn(),
  startHhApply: vi.fn(),
  finishHhApply: vi.fn(),
}));
const desktop = vi.hoisted(() => ({
  openHhSignIn: vi.fn(),
  readHhResumes: vi.fn(),
  readHhResumeContent: vi.fn(),
  summaryOf: vi.fn((item: { id: string; title: string }) => ({ id: item.id, title: item.title })),
  runHhApplyInSession: vi.fn(),
}));
vi.mock('./hhSessionApi', () => api);
vi.mock('./hhDesktop', () => desktop);
vi.mock('../../shell/Link', () => ({
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));

const { HhSendStep } = await import('./HhSendStep');

const head = { title: 'Директор по данным', company: 'Ромашка', url: 'https://hh.ru/vacancy/123' } as ApplyHead;
const snapshot = {
  resumes: [{ id: 'abc1', title: 'CDO' }],
  selected: { id: 'abc1', title: 'CDO', text: 'Опыт' },
  readAt: '2026-11-18T10:00:00.000Z',
};

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});
beforeEach(() => {
  vi.clearAllMocks();
  api.getHhResumes.mockResolvedValue(snapshot);
  api.startHhApply.mockResolvedValue({ attemptId: 'att-1', remainingToday: 14 });
  api.finishHhApply.mockResolvedValue(undefined);
  desktop.runHhApplyInSession.mockResolvedValue({ outcome: 'sent', failureCode: null });
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(onSent = vi.fn().mockResolvedValue(undefined)) {
  view = mount(
    <HhSendStep
      hhVacancyId="123"
      head={head}
      applicationId="app-1"
      approvedLabel="одобрено 18.11"
      letterText="Здравствуйте"
      onSent={onSent}
    />,
  );
  await settle();
  return onSent;
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found as HTMLButtonElement;
}

describe('B704: отклик через hh.ru в приложении', () => {
  it('без подтверждения ничего не уходит; после «Отправить» — отклик и отметка', async () => {
    const onSent = await render();
    expect(view!.container.textContent).toContain('«CDO»');
    click(button('Отправить отклик'));
    expect(api.startHhApply).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Отправить отклик на hh.ru?');
    click(button('Отмена'));
    expect(api.startHhApply).not.toHaveBeenCalled();

    click(button('Отправить отклик'));
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
    expect(api.startHhApply).toHaveBeenCalledWith('123', 'abc1');
    expect(desktop.runHhApplyInSession).toHaveBeenCalledWith({ vacancyId: '123', resumeId: 'abc1', letter: 'Здравствуйте' });
    expect(api.finishHhApply).toHaveBeenCalledWith('att-1', 'sent', undefined);
    expect(onSent).toHaveBeenCalledOnce();
    expect(view!.container.textContent).toContain('Отклик отправлен на hh.ru');
  });

  it('без резюме отправить нельзя', async () => {
    api.getHhResumes.mockResolvedValue(null);
    await render();
    expect(button('Отправить отклик').disabled).toBe(true);
  });

  it('нет входа в hh.ru → строка «нужен вход» и кнопка входа, отметки нет', async () => {
    desktop.runHhApplyInSession.mockResolvedValue({ outcome: 'failed', failureCode: 'not_signed_in' });
    const onSent = await render();
    click(button('Отправить отклик'));
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
    expect(api.finishHhApply).toHaveBeenCalledWith('att-1', 'failed', 'not_signed_in');
    expect(onSent).not.toHaveBeenCalled();
    expect(view!.container.textContent).toContain('Не отправлен · нужен вход в hh.ru');
    click(button('Войти в hh.ru'));
    expect(desktop.openHhSignIn).toHaveBeenCalledOnce();
  });

  it('отказ сервера (лимит) — окно hh.ru не трогаем', async () => {
    const { CoachApiError } = await import('../../../coach/apiClient');
    api.startHhApply.mockRejectedValue(Object.assign(Object.create(CoachApiError.prototype), { code: 'hh_daily_limit_reached', message: 'x' }));
    await render();
    click(button('Отправить отклик'));
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
    expect(desktop.runHhApplyInSession).not.toHaveBeenCalled();
    expect(view!.container.textContent).toContain('На сегодня отклики через hh.ru закончились');
  });
});
