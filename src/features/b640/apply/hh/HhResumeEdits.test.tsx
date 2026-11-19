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
  it('у должности, навыков и «О себе» есть «Применить», у опыта по местам — только копирование', () => {
    render();
    expect(buttons('Применить')).toHaveLength(3);
    const experience = [...document.querySelectorAll('.hh2-r')].find((row) => row.textContent?.includes('Ромашка'));
    expect(experience?.textContent).not.toContain('Применить');
  });

  it('«Применить» переносит один раздел и показывает, что hh.ru его принял', async () => {
    render();
    click(buttons('Применить')[1]!);
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
    expect(document.body.textContent).toContain('изменит: Должность, Навыки, О себе');
    click(buttons('Изменить')[0]!);
    await settle();
    await settle();
    expect(desktop.applyHhResumeEditInSession.mock.calls.map(([input]) => input.section)).toEqual(['title', 'skills', 'about']);
    expect(pace.pauseBetweenEdits).toHaveBeenCalledTimes(2);
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
