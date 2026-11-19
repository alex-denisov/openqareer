// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuestionnaireQuestion } from '../../../../shared/applicationQuestionnaire';
import { click, mount, type Mounted } from '../kit/testDom';
import { ChoiceField } from './ChoiceField';

const base: QuestionnaireQuestion = {
  id: 'q1',
  text: 'Готовы к командировкам?',
  required: true,
  kind: 'choice',
  options: ['Да', 'Нет'],
};

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function input(label: string): HTMLInputElement {
  const found = [...view!.container.querySelectorAll('label')].find((node) => node.textContent === label);
  const control = found?.querySelector('input');
  if (!control) throw new Error(`нет варианта «${label}»`);
  return control;
}

describe('B703: вопрос с выбором показан выбором, а не полем', () => {
  it('один ответ — переключатели в группе с названием вопроса', () => {
    const onPick = vi.fn();
    view = mount(<ChoiceField fieldId="qa-q1" question={base} value="Да" onPick={onPick} />);
    const group = view.container.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Ваш ответ: Готовы к командировкам?');
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(input('Да').checked).toBe(true);
    expect(view.container.querySelector('select')).toBeNull();
    click(input('Нет'));
    expect(onPick).toHaveBeenCalledWith('Нет');
  });

  it('несколько ответов — отметки, щелчок добавляет вариант', () => {
    const onPick = vi.fn();
    const question = { ...base, text: 'Стек?', options: ['Go', 'Rust'], multiple: true };
    view = mount(<ChoiceField fieldId="qa-q1" question={question} value="Rust" onPick={onPick} />);
    expect(view.container.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Ваш ответ: Стек?');
    expect(input('Rust').type).toBe('checkbox');
    expect(input('Rust').checked).toBe(true);
    click(input('Go'));
    expect(onPick).toHaveBeenCalledWith('Go\nRust');
  });

  it('сохранённый ответ вне вариантов виден отдельной отмеченной строкой', () => {
    view = mount(<ChoiceField fieldId="qa-q1" question={base} value="Иногда" onPick={vi.fn()} />);
    expect(input('Иногда').checked).toBe(true);
  });

  it('первый вариант получает id поля: к нему ведёт «Ответьте на обязательные»', () => {
    view = mount(<ChoiceField fieldId="qa-q1" question={base} value="" onPick={vi.fn()} />);
    expect(view.container.querySelector('#qa-q1')).toBe(input('Да'));
  });
});
