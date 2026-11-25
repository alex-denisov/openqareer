// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../kit/testDom';
import type { ApplyHead } from '../model/applyModel';
import type { HhSendForm } from './HhSendStep';

const api = vi.hoisted(() => ({
  getHhResumes: vi.fn(),
  saveHhResumes: vi.fn(),
  chooseHhResumeFor: vi.fn(),
  getHhResumeReview: vi.fn(),
  getHhResumeEdits: vi.fn(),
  startHhApply: vi.fn(),
  finishHhApply: vi.fn(),
}));
const desktop = vi.hoisted(() => ({
  openHhSignIn: vi.fn(),
  showHhResponse: vi.fn(),
  showHhCaptcha: vi.fn(),
  readHhResumes: vi.fn(),
  readHhResumeContent: vi.fn(),
  summaryOf: vi.fn((item: { id: string; title: string }) => ({ id: item.id, title: item.title })),
  runHhApplyInSession: vi.fn(),
  readHhApplyWindow: vi.fn(),
}));
vi.mock('./hhSessionApi', () => api);
vi.mock('../../../../services/desktop/desktopBridge', async (original) => ({
  ...(await original<object>()),
  isTauriEnvironment: () => true,
}));
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

const consentApi = vi.hoisted(() => ({ grantAccountCapabilityConsent: vi.fn() }));
vi.mock('../../../account/accountCapabilityConsentApi', () => consentApi);

const { HhSendStep } = await import('./HhSendStep');
const { CoachApiError } = await import('../../../coach/apiClient');

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
  vi.resetAllMocks();
  form = null;
  onForm.mockResolvedValue(undefined);
  desktop.summaryOf.mockImplementation((item) => ({ id: item.id, title: item.title }));
  api.getHhResumes.mockResolvedValue(snapshot);
  api.chooseHhResumeFor.mockResolvedValue(snapshot);
  desktop.readHhResumeContent.mockRejectedValue(new Error('hh_resume_not_read'));
  api.getHhResumeEdits.mockResolvedValue({ resumeId: 'abc1', vacancyId: 'cluster-1', edits: [] });
  api.startHhApply.mockResolvedValue({ attemptId: 'att-1', remainingToday: 14 });
  api.finishHhApply.mockResolvedValue(undefined);
  desktop.runHhApplyInSession.mockResolvedValue({ outcome: 'sent', failureCode: null });
  desktop.readHhApplyWindow.mockRejectedValue(new Error('session_window_missing'));
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const onForm = vi.fn();
let form: HhSendForm | null = null;
const ANSWERS = [{ text: 'Почему мы?', values: ['Потому'] }];
const FORM = (): HhSendForm => ({
  answered: 1,
  complete: true,
  answersText: 'Почему мы?\nПотому',
  answers: ANSWERS,
  onSubmitted: vi.fn(),
  visibilityAgreed: false,
  askVisibility: vi.fn(),
  open: vi.fn(),
});
const confirmSend = async () => {
  click(button('Отправить отклик'));
  click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
  await settle();
};

async function render(onSent = vi.fn().mockResolvedValue(undefined), onLetter = vi.fn()) {
  view = mount(
    <HhSendStep
      vacancyId="cluster-1"
      hhVacancyId="123"
      head={head}
      applicationId="app-1"
      approvedLabel="одобрено 18.11"
      letterText="Здравствуйте"
      onSent={onSent}
      form={form}
      onForm={onForm}
      onLetter={onLetter}
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
  it('название письма открывает шаг «Письмо» (a01)', async () => {
    const onLetter = vi.fn();
    await render(undefined, onLetter);
    click(button('Письмо · одобрено 18.11'));
    expect(onLetter).toHaveBeenCalledOnce();
  });

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
    expect(api.startHhApply).toHaveBeenCalledWith('123', 'abc1', expect.any(String));
    expect(desktop.runHhApplyInSession).toHaveBeenCalledWith({ vacancyId: '123', resumeId: 'abc1', letter: 'Здравствуйте', uniqueResumeTitle: 'CDO' });
    expect(api.finishHhApply).toHaveBeenCalledWith('att-1', 'sent', undefined);
    expect(onSent).toHaveBeenCalledOnce();
    expect(view!.container.textContent).toContain('Отклик отправлен на hh.ru');
  });

  it('B787: без поручения показывает его текст один раз; после согласия отклик уходит', async () => {
    api.startHhApply.mockRejectedValueOnce(new CoachApiError('нужно согласие', 'apply_mandate_required', false));
    consentApi.grantAccountCapabilityConsent.mockResolvedValue({});
    const onSent = await render();
    click(button('Отправить отклик'));
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
    expect(document.body.textContent).toContain('Поручаю OpenQareer по моей команде направлять отклик выбранному работодателю');
    expect(desktop.runHhApplyInSession).not.toHaveBeenCalled();
    click(button('Дать согласие'));
    await settle();
    expect(consentApi.grantAccountCapabilityConsent).toHaveBeenCalledExactlyOnceWith('actions_on_behalf', 'actions_on_behalf-v1.1');
    expect(desktop.runHhApplyInSession).toHaveBeenCalledOnce();
    expect(onSent).toHaveBeenCalledOnce();
  });

  it('B787: «Отмена» в поручении ничего не отправляет и не принимает', async () => {
    api.startHhApply.mockRejectedValueOnce(new CoachApiError('нужно согласие', 'apply_mandate_required', false));
    await render();
    click(button('Отправить отклик'));
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
    click(button('Отмена'));
    await settle();
    expect(consentApi.grantAccountCapabilityConsent).not.toHaveBeenCalled();
    expect(desktop.runHhApplyInSession).not.toHaveBeenCalled();
  });

  it('двойное «Отправить» до перерисовки — одна попытка', async () => {
    await render();
    click(button('Отправить отклик'));
    const send = [...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!;
    act(() => {
      send.click();
      send.click();
    });
    await settle();
    expect(api.startHhApply).toHaveBeenCalledOnce();
    expect(desktop.runHhApplyInSession).toHaveBeenCalledOnce();
  });

  it('B641: анкета до отклика — не отправлен, отметки нет, вопросы уходят в шаг «Анкета»', async () => {
    const questionnaire = {
      url: 'https://hh.ru/applicant/vacancy_response?vacancyId=123&hhtmFrom=vacancy',
      questions: [{ text: 'Почему мы?', required: true, kind: 'text' }],
    };
    desktop.runHhApplyInSession.mockResolvedValue({
      outcome: 'failed',
      failureCode: 'questionnaire_required',
      questionnaire,
    });
    form = FORM();
    const onSent = await render();
    click(button('1 ответ анкеты'));
    expect(form.open).toHaveBeenCalledOnce();
    click(button('Отправить отклик'));
    expect(onForm).not.toHaveBeenCalled();
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
    expect(api.finishHhApply).toHaveBeenCalledWith('att-1', 'failed', 'questionnaire_required');
    expect(onForm).toHaveBeenCalledExactlyOnceWith(questionnaire, true);
    expect(onSent).not.toHaveBeenCalled();
    expect(view!.container.textContent).toContain('Не отправлен · работодатель просит анкету');
    expect(button('Скопировать ответы')).toBeTruthy();
    click(button('Открыть окно hh.ru'));
    expect(desktop.showHhResponse).toHaveBeenCalledOnce();
  });

  it('B641: анкета не читается и ответов нет — только «Открыть окно hh.ru»', async () => {
    desktop.runHhApplyInSession.mockResolvedValue({
      outcome: 'failed',
      failureCode: 'questionnaire_required',
      questionnaire: { url: '', questions: [] },
    });
    await render();
    click(button('Отправить отклик'));
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
    expect(() => button('Скопировать ответы')).toThrow();
    expect(button('Открыть окно hh.ru')).toBeTruthy();
  });

  it('B787: ответы анкеты уходят вместе с откликом; анкета отмечена отправленной', async () => {
    form = FORM();
    desktop.runHhApplyInSession.mockResolvedValue({
      outcome: 'sent',
      consents: [{ text: 'Согласен на обработку персональных данных', url: null }],
    });
    api.startHhApply.mockResolvedValue({ attemptId: 'att-1', remainingToday: 14, consent: true });
    const onSent = await render();
    await confirmSend();
    expect(desktop.runHhApplyInSession).toHaveBeenCalledWith(expect.objectContaining({ answers: ANSWERS, consent: true }));
    expect(api.finishHhApply).toHaveBeenCalledWith('att-1', 'sent', undefined, undefined, {
      consents: [{ text: 'Согласен на обработку персональных данных', url: null }],
      employer: head.company,
      applicationId: 'app-1',
    });
    expect(form.onSubmitted).toHaveBeenCalledOnce();
    expect(onSent).toHaveBeenCalledOnce();
  });

  it.each([
    ['relocation_warning', 'Откликнуться', 'agreedRelocation'],
    ['visibility_warning', 'Разрешить', 'agreedVisibility'],
    ['consent_required', 'Согласиться', 'consent'],
  ])('B787: %s — вопрос на экране, «да» отправляет снова с ответом', async (failureCode, yes, flag) => {
    desktop.runHhApplyInSession.mockResolvedValueOnce({ outcome: 'failed', failureCode });
    const onSent = await render();
    await confirmSend();
    expect(onSent).not.toHaveBeenCalled();
    expect(desktop.runHhApplyInSession.mock.calls[0]![0]).not.toHaveProperty(flag);
    click([...document.querySelectorAll('button')].find((item) => item.textContent === yes)!);
    await settle();
    expect(desktop.runHhApplyInSession).toHaveBeenLastCalledWith(expect.objectContaining({ [flag]: true }));
    expect(onSent).toHaveBeenCalledOnce();
  });

  it('B787: вопрос о показе резюме при анкете встаёт в анкету; ответ «Да» уходит с откликом', async () => {
    form = FORM();
    desktop.runHhApplyInSession.mockResolvedValueOnce({ outcome: 'failed', failureCode: 'visibility_warning' });
    await render();
    await confirmSend();
    expect(form.askVisibility).toHaveBeenCalledOnce();
    expect(desktop.runHhApplyInSession.mock.calls[0]![0]).not.toHaveProperty('agreedVisibility');
    view!.unmount();
    form = { ...FORM(), visibilityAgreed: true };
    await render();
    await confirmSend();
    expect(desktop.runHhApplyInSession).toHaveBeenLastCalledWith(expect.objectContaining({ agreedVisibility: true }));
  });

  it('B787: отклик на hh.ru уже есть — отмечается, а не ошибка', async () => {
    desktop.runHhApplyInSession.mockResolvedValue({ outcome: 'failed', failureCode: 'already_applied' });
    const onSent = await render();
    await confirmSend();
    expect(onSent).toHaveBeenCalledOnce();
    expect(view!.container.textContent).toContain('Вы уже откликнулись на hh.ru');
    expect(() => button('Отправить отклик')).toThrow();
  });

  it('B787: снятая вакансия — своя строка без окна; капча — окно проверки', async () => {
    desktop.runHhApplyInSession.mockResolvedValue({ outcome: 'failed', failureCode: 'vacancy_closed' });
    await render();
    await confirmSend();
    expect(view!.container.textContent).toContain('Вакансия снята с hh.ru');
    expect(() => button('Открыть окно hh.ru')).toThrow();
    desktop.runHhApplyInSession.mockResolvedValue({ outcome: 'failed', failureCode: 'captcha' });
    await confirmSend();
    click(button('Открыть окно hh.ru'));
    expect(desktop.showHhCaptcha).toHaveBeenCalledOnce();
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

    api.startHhApply.mockRejectedValue(Object.assign(Object.create(CoachApiError.prototype), { code: 'hh_daily_limit_reached', message: 'x' }));
    await render();
    click(button('Отправить отклик'));
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
    expect(desktop.runHhApplyInSession).not.toHaveBeenCalled();
    expect(view!.container.textContent).toContain('На сегодня отклики через hh.ru закончились');
  });

  it('B787: отказ, которого сборка не знает (старая .app), — ошибка на месте, а не ожидание', async () => {
    api.startHhApply.mockRejectedValue(new CoachApiError('x', 'unknown_refusal', false));
    await render();
    click(button('Отправить отклик'));
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
    expect(view!.container.textContent).toContain('Отклик не отправлен. Повторите.');
    expect(view!.container.textContent).not.toContain('Ждём ответа');
    expect(desktop.runHhApplyInSession).not.toHaveBeenCalled();
  });

  it('B678: лист выбора сверяет резюме с вакансией и выбирает рекомендованное', async () => {
    const items = [
      { id: 'abc1', title: 'CDO', url: 'https://hh.ru/resume/abc1' },
      { id: 'def2', title: 'Head of Data', url: 'https://hh.ru/resume/def2' },
    ];
    desktop.readHhResumes.mockResolvedValue({ kind: 'ready', resumes: items });
    desktop.readHhResumeContent.mockImplementation(async (item: { id: string; title: string }) => ({ id: item.id, title: item.title, text: 'Опыт' }));
    api.saveHhResumes.mockImplementation(async (resumes, selected, contents) => ({ resumes, selected, contents, readAt: 'x' }));
    api.getHhResumeReview.mockResolvedValue({
      vacancyId: 'cluster-1',
      requirements: ['SQL', 'dbt'],
      recommendedId: 'def2',
      resumes: [
        { resumeId: 'abc1', title: 'CDO', status: 'gaps', matched: ['SQL'], missing: ['dbt'] },
        { resumeId: 'def2', title: 'Head of Data', status: 'fits', matched: ['SQL', 'dbt'], missing: [] },
      ],
    });
    await render();
    click(button('Резюме hh.ru «CDO»'));
    await settle();

    const sheet = document.body.textContent ?? '';
    expect(sheet).toContain('не хватает: dbt');
    expect(sheet).toContain('подходит');
    expect(sheet).toContain('Рекомендуем');
    const radios = [...document.querySelectorAll<HTMLInputElement>('.hh2-pick input[type=radio]')];
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
    click(button('Продолжить'));
    await settle();
    expect(api.saveHhResumes).toHaveBeenLastCalledWith(
      [{ id: 'abc1', title: 'CDO' }, { id: 'def2', title: 'Head of Data' }],
      { id: 'def2', title: 'Head of Data', text: 'Опыт' },
      undefined,
      'cluster-1',
    );
    expect(api.chooseHhResumeFor).toHaveBeenCalledWith('cluster-1', 'def2');
  });

  it('B678: лист a01b — «N правок» с «Оптимизировать» ведёт в разбор, «Без правок» — сразу к отправке', async () => {
    const sections = { title: 'CDO', about: '', skills: [], places: [{ employer: 'Ромашка', title: 'CDO', period: '2020', text: 'Вёл данные.' }] };
    const items = ['abc1', 'def2'].map((id) => ({ id, title: id, url: `https://hh.ru/resume/${id}` }));
    desktop.readHhResumes.mockResolvedValue({ kind: 'ready', resumes: items });
    desktop.readHhResumeContent.mockImplementation(async (item: { id: string; title: string }) => ({ ...item, text: 'Опыт', sections }));
    api.saveHhResumes.mockImplementation(async (resumes, selected) => ({ resumes, selected, readAt: String(Math.random()) }));
    api.getHhResumeReview.mockResolvedValue({
      vacancyId: 'cluster-1', requirements: [], recommendedId: 'abc1',
      resumes: [
        { resumeId: 'abc1', title: 'abc1', status: 'fits', matched: [], missing: [], editCount: 5 },
        { resumeId: 'def2', title: 'def2', status: 'fits', matched: [], missing: [], editCount: 0 },
      ],
    });
    api.chooseHhResumeFor.mockImplementation(async (_vacancy, id) => ({ resumes: items, selected: { id, title: id, text: 'Опыт', sections }, readAt: String(Math.random()) }));
    api.getHhResumeEdits.mockResolvedValue({
      resumeId: 'abc1', vacancyId: 'cluster-1', edits: [{ id: 'title', section: 'title', was: 'a', now: 'b' }],
    });
    await render();
    const optimise = () => document.querySelector<HTMLInputElement>('.hh2-opt input');
    const open = async () => {
      click(button('Резюме hh.ru «'));
      await settle();
    };
    await open();
    const picks = [...document.querySelectorAll('.hh2-pick')];
    expect(picks[0]!.textContent).toContain('5 правок');
    expect(picks[0]!.textContent).toContain('Оптимизировать');
    expect(picks[1]!.textContent).toContain('Без правок');
    expect(picks[1]!.textContent).not.toContain('Оптимизировать');
    expect(optimise()!.checked).toBe(true);
    click(optimise()!);
    click(button('Продолжить'));
    await settle();
    expect(view!.container.textContent).toContain('Всё одобрено');
    await open();
    click(optimise()!);
    click(button('Продолжить'));
    await settle();
    expect(button('К отправке')).toBeTruthy();
  });

  it('B678: прежний снимок без разделов перечитывается сам, выбирать резюме заново не нужно', async () => {
    const sections = { title: 'CDO', about: '', skills: [], places: [{ employer: 'Ромашка', title: 'CDO', period: '2020', text: 'Вёл данные.' }] };
    desktop.readHhResumeContent.mockResolvedValue({ ...snapshot.selected, sections });
    api.saveHhResumes.mockImplementation(async (resumes, selected) => ({ resumes, selected, readAt: 'x' }));
    await render();
    expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(1);
    expect(api.getHhResumeEdits).toHaveBeenCalledTimes(1);
    expect(button('Отправить отклик').disabled).toBe(false);
  });

  it('B678: «N правок» открывает разбор резюме «сейчас → предложение» и возвращает к отправке', async () => {
    const sections = { title: 'CDO', about: '', skills: ['SQL'], places: [{ employer: 'Ромашка', title: 'CDO', period: '2020', text: 'Вёл данные.' }] };
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

  it('B678: у резюме без прочитанных разделов правки не запрашиваются', async () => {
    await render();
    expect(api.getHhResumeEdits).not.toHaveBeenCalled();
    expect(view!.container.textContent).not.toContain('правк');
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
    expect(text).not.toContain('можно отправлять');
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

  const send = async () => {
    click(button('Отправить отклик'));
    click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Отправить')!);
    await settle();
  };

  it('B708: отклик завершён в окне hh.ru — отмечается сам, тот же результат, что после отправки', async () => {
    desktop.runHhApplyInSession.mockResolvedValue({ outcome: 'failed', failureCode: 'popup_missing' });
    desktop.readHhApplyWindow.mockResolvedValue('sent');
    const onSent = await render();
    await send();
    await settle();
    expect(desktop.readHhApplyWindow).toHaveBeenCalledWith('123');
    expect(api.finishHhApply.mock.calls).toEqual([
      ['att-1', 'failed', 'popup_missing'],
      ['att-1', 'sent', undefined, '123'],
    ]);
    expect(onSent).toHaveBeenCalledOnce();
    expect(view!.container.textContent).toContain('Отклик отправлен на hh.ru');
    expect(view!.container.textContent).not.toContain('Отправить отклик');
  });

  it('B708: сервер отклонил поздний исход — отметки нет', async () => {
    desktop.runHhApplyInSession.mockResolvedValue({ outcome: 'failed', failureCode: 'popup_missing' });
    desktop.readHhApplyWindow.mockResolvedValue('sent');

    api.finishHhApply.mockImplementation(async (_id: string, outcome: string) => {
      if (outcome === 'sent') throw Object.assign(Object.create(CoachApiError.prototype), { status: 404 });
    });
    const onSent = await render();
    await send();
    await settle();
    expect(onSent).not.toHaveBeenCalled();
    expect(view!.container.textContent).toContain('hh.ru не открыл окно отклика');
  });

  it('B708: экран закрыт, пока окно читается, — отметка всё равно ставится', async () => {
    desktop.runHhApplyInSession.mockResolvedValue({ outcome: 'failed', failureCode: 'popup_missing' });
    let answer: (code: string) => void = () => undefined;
    desktop.readHhApplyWindow.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const onSent = await render();
    await send();
    view!.unmount();
    view = null;
    answer('sent');
    await settle();
    expect(onSent).toHaveBeenCalledOnce();
  });
});
