// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HhResumeEdit } from '../../../../../shared/hhCandidateSession';
import { click, mount, type Mounted } from '../../kit/testDom';

const desktop = vi.hoisted(() => ({ applyHhResumeEditInSession: vi.fn() }));
const reading = vi.hoisted(() => ({ forgetReadResumes: vi.fn() }));
const pace = vi.hoisted(() => ({ pauseBetweenEdits: vi.fn(async () => undefined) }));
vi.mock('./hhDesktop', () => desktop);
vi.mock('./hhResumeReading', () => reading);
vi.mock('./hhEditPace', () => pace);

const { HhResumeEdits } = await import('./HhResumeEdits');

const edits: HhResumeEdit[] = [
  { id: 'title', section: 'title', was: 'CDO', now: 'Директор по данным' },
  { id: 'experience:0', section: 'experience', place: 'Ромашка · 2020 — н.в.', was: 'Вёл данные.', now: 'Построил платформу.' },
  {
    id: 'experience:1',
    section: 'experience',
    place: 'Лютик · 2016 — 2020',
    employer: 'Лютик',
    position: 'Аналитик',
    was: 'Считал отчёты.',
    now: 'Собрал витрину продаж.',
  },
  { id: 'skills', section: 'skills', was: 'SQL', now: 'SQL, dbt', added: ['dbt'] },
  { id: 'about', section: 'about', was: '', now: 'Строю платформы данных.' },
];

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});
beforeEach(() => {
  vi.clearAllMocks();
  desktop.applyHhResumeEditInSession.mockResolvedValue({ outcome: 'applied', failureCode: null });
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function render() {
  view = mount(<HhResumeEdits resumeId="abc1" resumeTitle="CDO" edits={edits} onBack={vi.fn()} />);
}

function buttons(text: string): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].filter((item) => item.textContent?.trim() === text);
}

describe('B678, срез 3: «Применить» на hh.ru', () => {
  it('«Применить» есть у должности, навыков, «О себе» и у места работы, которое hh.ru показал с работодателем и должностью', () => {
    render();
    expect(buttons('Применить')).toHaveLength(4);
    const unnamed = [...document.querySelectorAll('.hh2-r')].find((row) => row.textContent?.includes('Ромашка'));
    expect(unnamed?.textContent).not.toContain('Применить');
  });

  it('место работы уходит в приложение с работодателем, должностью и прежним текстом — по ним hh.ru находит исходное место', async () => {
    render();
    const row = [...document.querySelectorAll('.hh2-r')].find((item) => item.textContent?.includes('Лютик'));
    click([...row!.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Применить')!);
    await settle();
    expect(desktop.applyHhResumeEditInSession).toHaveBeenCalledWith({
      resumeId: 'abc1',
      section: 'experience',
      employer: 'Лютик',
      position: 'Аналитик',
      was: 'Считал отчёты.',
      text: 'Собрал витрину продаж.',
    });
  });

  it('если у места работы на hh.ru отмечено и другое резюме, приложение ничего не сохраняет и просит скопировать', async () => {
    desktop.applyHhResumeEditInSession.mockResolvedValue({ outcome: 'failed', failureCode: 'other_resumes_ticked' });
    render();
    const row = [...document.querySelectorAll('.hh2-r')].find((item) => item.textContent?.includes('Лютик'));
    click([...row!.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Применить')!);
    await settle();
    expect(row!.textContent).toContain('другими резюме');
    expect(row!.textContent).not.toContain('Изменено на hh.ru');
  });

  it('«Применить» переносит один раздел и показывает, что hh.ru его принял', async () => {
    render();
    click(buttons('Применить')[2]!);
    await settle();
    expect(desktop.applyHhResumeEditInSession).toHaveBeenCalledWith({ resumeId: 'abc1', section: 'skills', text: '', skills: ['dbt'] });
    expect(view!.container.textContent).toContain('Изменено на hh.ru');
    expect(reading.forgetReadResumes).toHaveBeenCalled();
  });

  it('«Применить все на hh.ru» ничего не меняет до подтверждения, после — по одному разделу', async () => {
    render();
    click(buttons('Применить все на hh.ru')[0]!);
    await settle();
    expect(desktop.applyHhResumeEditInSession).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('изменит: Должность, Опыт по местам, Навыки, О себе');
    click(buttons('Изменить')[0]!);
    await settle();
    await settle();
    await settle();
    expect(desktop.applyHhResumeEditInSession.mock.calls.map(([input]) => input.section)).toEqual(['title', 'experience', 'skills', 'about']);
    expect(pace.pauseBetweenEdits).toHaveBeenCalledTimes(3);
  });

  it('отказ hh.ru — понятная строка под правкой, остальные разделы не трогаем', async () => {
    desktop.applyHhResumeEditInSession.mockResolvedValueOnce({ outcome: 'failed', failureCode: 'captcha' });
    render();
    click(buttons('Применить все на hh.ru')[0]!);
    await settle();
    click(buttons('Изменить')[0]!);
    await settle();
    expect(desktop.applyHhResumeEditInSession).toHaveBeenCalledTimes(1);
    expect(view!.container.querySelector('.hh2-err')?.textContent).toContain('не робот');
  });
});
