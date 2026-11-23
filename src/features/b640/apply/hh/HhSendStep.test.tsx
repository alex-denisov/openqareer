// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../kit/testDom';
import type { ApplyHead } from '../model/applyModel';

const api = vi.hoisted(() => ({
  getHhResumes: vi.fn(),
  saveHhResumes: vi.fn(),
  getHhResumeReview: vi.fn(),
  getHhResumeEdits: vi.fn(),
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
// Темп чтения страниц hh.ru проверяет hhResumeReading.test.ts; здесь читаем без пауз.
vi.mock('./hhResumeReading', () => ({
  forReview: (content: unknown) => content,
  readResumesForReview: async (items: Array<{ id: string; title: string }>) =>
    Promise.all(items.map((item) => desktop.readHhResumeContent(item))),
}));
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
  api.getHhResumeEdits.mockResolvedValue({ resumeId: 'abc1', vacancyId: 'cluster-1', edits: [] });
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
      vacancyId="cluster-1"
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

  it('B678, a01b: у резюме «N правок» или «Без правок», выбрано рекомендованное, «Оптимизировать» ведёт к разбору', async () => {
    const sections = { title: 'CDO', about: '', skills: ['SQL'], places: [] };
    const items = [
      {
        id: 'abc1',
        title: 'CDO',
        url: 'https://hh.ru/resume/abc1',
        updatedLabel: 'обновлено в 2023',
      },
      {
        id: 'def2',
        title: 'Head of Data',
        url: 'https://hh.ru/resume/def2',
        updatedLabel: 'обновлено 3 ноября',
      },
    ];
    desktop.readHhResumes.mockResolvedValue({ kind: 'ready', resumes: items });
    desktop.readHhResumeContent.mockImplementation(async (item: { id: string; title: string }) => ({
      id: item.id,
      title: item.title,
      text: 'Опыт',
      sections,
    }));
    api.saveHhResumes.mockImplementation(async (resumes, selected, contents) => ({
      resumes,
      selected,
      contents,
      readAt: 'x',
    }));
    api.getHhResumeReview.mockResolvedValue({
      vacancyId: 'cluster-1',
      requirements: ['SQL', 'dbt'],
      recommendedId: 'def2',
      resumes: [
        { resumeId: 'abc1', title: 'CDO', status: 'fits', matched: ['SQL', 'dbt'], missing: [] },
        {
          resumeId: 'def2',
          title: 'Head of Data',
          status: 'gaps',
          matched: ['SQL'],
          missing: ['dbt'],
        },
      ],
    });
    const five = Array.from({ length: 5 }, (_, index) => ({
      id: `e${index}`,
      section: 'about',
      was: 'было',
      now: 'станет',
    }));
    api.getHhResumeEdits.mockImplementation(
      async (_vacancy: string, _signal: unknown, resumeId?: string) => ({
        resumeId: resumeId ?? 'def2',
        vacancyId: 'cluster-1',
        edits: resumeId === 'abc1' ? [] : five,
      }),
    );
    await render();
    click(button('Другое резюме'));
    await settle();

    const sheet = document.querySelector('.hh2-sheet')!;
    expect(sheet.textContent).toContain('CDO · обновлено в 2023');
    expect(sheet.textContent).toContain('Head of Data · обновлено 3 ноября');
    expect([...sheet.querySelectorAll('.hh2-st .tag')].map((tag) => tag.textContent)).toEqual([
      'Без правок',
      '5 правок',
    ]);
    expect(sheet.textContent).not.toContain('Рекомендуем');
    expect(sheet.textContent).not.toContain('не хватает');
    const radios = [...sheet.querySelectorAll<HTMLInputElement>('.hh2-pick input[type=radio]')];
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
    const optimize = [...sheet.querySelectorAll<HTMLInputElement>('.hh2-opt input[type=checkbox]')];
    expect(optimize).toHaveLength(1);
    expect(optimize[0]!.checked).toBe(true);

    click(button('Продолжить'));
    await settle();
    expect(api.saveHhResumes).toHaveBeenLastCalledWith(
      [
        { id: 'abc1', title: 'CDO' },
        { id: 'def2', title: 'Head of Data' },
      ],
      { id: 'def2', title: 'Head of Data', text: 'Опыт', sections },
    );
    expect(view!.container.textContent).toContain('К отправке');
    expect(desktop.runHhApplyInSession).not.toHaveBeenCalled();
  });

  it('B678, a01b: «Оптимизировать» — пока правки готовятся, строка ожидания; экран отправки не мелькает', async () => {
    const sections = { title: 'CDO', about: '', skills: ['SQL'], places: [] };
    desktop.readHhResumes.mockResolvedValue({ kind: 'ready', resumes: [{ id: 'abc1', title: 'CDO', url: 'https://hh.ru/resume/abc1' }] });
    desktop.readHhResumeContent.mockResolvedValue({ id: 'abc1', title: 'CDO', text: 'Опыт', sections });
    api.saveHhResumes.mockImplementation(async (resumes, selected, contents) => ({ resumes, selected, contents, readAt: `t${Math.random()}` }));
    api.getHhResumeReview.mockResolvedValue(null);
    const edits = [{ id: 'title', section: 'title', was: 'CDO', now: 'Директор по данным' }];
    let finish: (value: unknown) => void = () => undefined;
    api.getHhResumeEdits.mockImplementation((_vacancy: string, _signal: unknown, resumeId?: string) =>
      resumeId ? Promise.resolve({ resumeId, vacancyId: 'cluster-1', edits }) : new Promise((resolve) => (finish = resolve)));
    await render();
    click(button('Другое резюме'));
    await settle();
    click(button('Продолжить'));
    await settle();

    expect(view!.container.textContent).toContain('Готовим правки');
    expect(view!.container.textContent).not.toContain('Всё одобрено');
    await act(async () => finish({ resumeId: 'abc1', vacancyId: 'cluster-1', edits }));
    await settle();
    expect(view!.container.textContent).toContain('К отправке');
  });

  it('B678, a01b: без «Оптимизировать» — сразу к отправке', async () => {
    const sections = { title: 'CDO', about: '', skills: ['SQL'], places: [] };
    const item = { id: 'abc1', title: 'CDO', url: 'https://hh.ru/resume/abc1' };
    desktop.readHhResumes.mockResolvedValue({ kind: 'ready', resumes: [item] });
    desktop.readHhResumeContent.mockResolvedValue({
      id: 'abc1',
      title: 'CDO',
      text: 'Опыт',
      sections,
    });
    api.saveHhResumes.mockImplementation(async (resumes, selected, contents) => ({
      resumes,
      selected,
      contents,
      readAt: 'y',
    }));
    api.getHhResumeReview.mockResolvedValue(null);
    api.getHhResumeEdits.mockResolvedValue({
      resumeId: 'abc1',
      vacancyId: 'cluster-1',
      edits: [{ id: 'title', section: 'title', was: 'CDO', now: 'Директор по данным' }],
    });
    await render();
    click(button('Другое резюме'));
    await settle();
    click(document.querySelector<HTMLInputElement>('.hh2-opt input[type=checkbox]')!);
    click(button('Продолжить'));
    await settle();
    expect(view!.container.textContent).toContain('Всё одобрено — можно отправлять');
  });

  it('B678: «N правок» открывает разбор резюме «сейчас → предложение» и возвращает к отправке', async () => {
    const sections = { title: 'CDO', about: '', skills: ['SQL'], places: [] };
    api.getHhResumes.mockResolvedValue({ ...snapshot, selected: { ...snapshot.selected, sections } });
    api.getHhResumeEdits.mockResolvedValue({
      resumeId: 'abc1',
      vacancyId: 'cluster-1',
      edits: [
        { id: 'title', section: 'title', was: 'CDO', now: 'Директор по данным' },
        { id: 'experience:0', section: 'experience', place: 'Ромашка · 2020 — н.в.', was: 'Вёл данные.', now: 'Построил платформу данных.\nВнедрил dbt.' },
      ],
    });
    await render();
    expect(api.getHhResumeEdits).toHaveBeenCalledWith('cluster-1', expect.anything());
    click(button('2 правки'));
    await settle();

    const text = view!.container.textContent ?? '';
    expect(text).toContain('Должность');
    expect(text).toContain('Опыт по местам');
    expect(text).toContain('Ромашка · 2020 — н.в.');
    expect(view!.container.querySelectorAll('.hh2-now .hh2-line')).toHaveLength(3);
    expect(view!.container.querySelectorAll('button[aria-label="Скопировать"]')).toHaveLength(2);
    expect(desktop.runHhApplyInSession).not.toHaveBeenCalled();
    click(button('К отправке'));
    await settle();
    expect(view!.container.textContent).toContain('«CDO»');
  });

  it('B678: выбранное резюме без прочитанных разделов перечитывается в окне hh.ru само — правки без повторного выбора', async () => {
    const sections = { title: 'CDO', about: '', skills: ['SQL'], places: [] };
    desktop.readHhResumeContent.mockResolvedValue({
      id: 'abc1',
      title: 'CDO',
      text: 'Опыт',
      sections,
    });
    api.saveHhResumes.mockImplementation(async (resumes, selected) => ({
      resumes,
      selected,
      readAt: 'z',
    }));
    api.getHhResumeEdits.mockResolvedValue({
      resumeId: 'abc1',
      vacancyId: 'cluster-1',
      edits: [{ id: 'title', section: 'title', was: 'CDO', now: 'Директор по данным' }],
    });
    await render();
    await settle();

    expect(desktop.readHhResumeContent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'abc1', url: 'https://hh.ru/resume/abc1' }),
    );
    expect(api.saveHhResumes).toHaveBeenCalledWith([{ id: 'abc1', title: 'CDO' }], {
      id: 'abc1',
      title: 'CDO',
      text: 'Опыт',
      sections,
    });
    expect(view!.container.textContent).toContain('1 правка');
  });

  it('B678: единственное резюме без выбора выбирается само', async () => {
    const sections = { title: 'CDO', about: '', skills: ['SQL'], places: [] };
    api.getHhResumes.mockResolvedValue({ ...snapshot, selected: null });
    desktop.readHhResumeContent.mockResolvedValue({
      id: 'abc1',
      title: 'CDO',
      text: 'Опыт',
      sections,
    });
    api.saveHhResumes.mockImplementation(async (resumes, selected) => ({
      resumes,
      selected,
      readAt: 'z',
    }));
    await render();
    await settle();
    expect(view!.container.textContent).toContain('«CDO»');
  });

  it('B678: перечитать не вышло (нет окна hh.ru) — правок нет, отправка как была', async () => {
    desktop.readHhResumeContent.mockRejectedValue(new Error('desktop_unavailable'));
    await render();
    await settle();
    expect(api.getHhResumeEdits).not.toHaveBeenCalled();
    expect(view!.container.textContent).not.toContain('правк');
    expect(button('Отправить отклик').disabled).toBe(false);
  });

  it('B716: «Я уже откликнулся» — отметка без окна hh.ru, отклик уходит из черновиков', async () => {
    const onSent = await render();
    click(button('Я уже откликнулся'));
    await settle();
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(api.startHhApply).not.toHaveBeenCalled();
    expect(desktop.runHhApplyInSession).not.toHaveBeenCalled();
    const text = view!.container.textContent ?? '';
    expect(text).toContain('Отклик отмечен как отправленный');
    expect(text).not.toContain('Отправить отклик');
  });

  it('B716: отметка не сохранилась — строка ошибки, отправка остаётся', async () => {
    const onSent = vi.fn().mockRejectedValue(new Error('Сеть недоступна'));
    await render(onSent);
    click(button('Я уже откликнулся'));
    await settle();
    const text = view!.container.textContent ?? '';
    expect(text).toContain('Отметка не сохранилась');
    expect(text).toContain('Отправить отклик');
  });
});
