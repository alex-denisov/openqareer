// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import { SkillQuestion, type SkillQuestionProps } from './SkillQuestion';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

const props = (patch: Partial<SkillQuestionProps>): SkillQuestionProps => ({
  eyebrow: 'Управление сроками · вопрос 4 из 6',
  title: 'Сроки сорвались. Что сделаете?',
  criteria: ['Что сделаете в первые три дня', 'Как скажете заказчику', 'Как не допустить повтора'],
  answer: 'Разберу причины с командой.',
  busy: false,
  failed: false,
  onChange: () => undefined,
  onSubmit: () => undefined,
  onRetry: () => undefined,
  onLater: () => undefined,
  ...patch,
});

describe('SkillQuestion: оценка кейса идёт (B734)', () => {
  it('пока кейс оценивается, на месте строка «Оцениваем ответ»', () => {
    view = mount(<SkillQuestion {...props({ busy: true })} />);
    expect(view.container.textContent).toContain('Оцениваем ответ');
  });

  it('без оценки строки нет', () => {
    view = mount(<SkillQuestion {...props({})} />);
    expect(view.container.textContent).not.toContain('Оцениваем ответ');
  });

  it('вопрос о роли без пунктов не оценивается — строки нет', () => {
    view = mount(<SkillQuestion {...props({ busy: true, criteria: undefined })} />);
    expect(view.container.textContent).not.toContain('Оцениваем ответ');
  });
});
