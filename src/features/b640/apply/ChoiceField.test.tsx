// @vitest-environment jsdom
import { act } from 'react';
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

function typeInto(field: HTMLInputElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

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

  describe('B641: длинный список', () => {
    const options = Array.from({ length: 255 }, (_, index) => `Country ${index}`);
    const long = { ...base, options };
    const radios = () => view!.container.querySelectorAll('input[type="radio"]').length;
    const search = () => view!.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    it('показывает 20 вариантов и остальные по «Показать ещё»', () => {
      view = mount(<ChoiceField fieldId="qa-q1" question={long} value="" onPick={vi.fn()} />);
      expect(radios()).toBe(20);
      click(view.container.querySelector('button'));
      expect(radios()).toBe(40);
      expect(search().id).toBe('qa-q1');
      // Поле поиска — как в фильтрах макета: рамка и значок у обёртки `.search`.
      expect(search().closest('.search')?.querySelector('svg')).toBeTruthy();
    });

    it('поиск находит вариант в конце списка, выбранный виден всегда', () => {
      const onPick = vi.fn();
      view = mount(<ChoiceField fieldId="qa-q1" question={long} value="Country 200" onPick={onPick} />);
      expect(input('Country 200').checked).toBe(true);
      typeInto(search(), ' country 254 ');
      expect(radios()).toBe(2);
      click(input('Country 254'));
      expect(onPick).toHaveBeenCalledWith('Country 254');
      typeInto(search(), 'zzz');
      expect(view.container.textContent).toContain('Ничего не нашлось');
      expect(input('Country 200').checked).toBe(true);
    });

    it('короткий список — без поиска', () => {
      view = mount(<ChoiceField fieldId="qa-q1" question={base} value="" onPick={vi.fn()} />);
      expect(search()).toBeNull();
    });
  });

  it('первый вариант получает id поля: к нему ведёт «Ответьте на обязательные»', () => {
    view = mount(<ChoiceField fieldId="qa-q1" question={base} value="" onPick={vi.fn()} />);
    expect(view.container.querySelector('#qa-q1')).toBe(input('Да'));
  });
});
