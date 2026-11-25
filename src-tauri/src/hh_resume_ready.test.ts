// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(join(__dirname, 'hh_resume_ready.js'), 'utf8');
const run = (html: string): unknown => {
  document.body.innerHTML = html;
  return (0, eval)(source) as unknown;
};
const scrollTo = vi.fn();

beforeEach(() => {
  scrollTo.mockClear();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
});

describe('готовность резюме hh.ru к чтению', () => {
  it('считает карточки и ступени, прокручивает и не отдаёт текст', () => {
    const state = run(
      '<div data-qa="profile-experience-company-card"><p>Секретная компания</p><div data-qa="magritte-stepper-step"></div><div data-qa="magritte-stepper-step"></div></div><div data-qa="resume-about-card">О себе</div>',
    );
    expect(state).toMatch(/^c1_s2_a1_l0_w\d+_e1$/u);
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it('узкая страница без блоков опыта — ноль карточек', () => {
    expect(run('<main>Редактировать Статистика за неделю</main>')).toMatch(/^c0_s0_a0_l0_/u);
  });

  it('видит прежнюю разметку опыта', () => {
    expect(run('<div data-qa="resume-block-experience-position">x</div>')).toMatch(/_l1_/u);
  });
});
