// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, mount } from '../../kit/testDom';
import { ReviewButton, TriageBar, TriageError, TriageQuestion, TriageStatus } from './TriageParts';

describe('кнопка «Помочь выбрать»', () => {
  it('в обычном режиме без aria-current, в режиме — aria-current="true"', () => {
    const off = mount(<ReviewButton active={false} onClick={vi.fn()} />);
    const button = off.container.querySelector('button.btn.va-review')!;
    expect(button.textContent).toBe('Помочь выбрать');
    expect(button.getAttribute('aria-current')).toBeNull();
    off.unmount();
    const on = mount(<ReviewButton active onClick={vi.fn()} />);
    expect(on.container.querySelector('.va-review')!.getAttribute('aria-current')).toBe('true');
    on.unmount();
  });

  it('значок chat и нажатие', () => {
    const onClick = vi.fn();
    const view = mount(<ReviewButton active={false} onClick={onClick} />);
    expect(view.container.querySelector('.va-review svg, .va-review .ico')).not.toBeNull();
    click(view.container.querySelector('.va-review'));
    expect(onClick).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

describe('вопрос по одному', () => {
  it('«1 из 2», текст, «Да» и «Нет» отправляют ответ', () => {
    const onAnswer = vi.fn();
    const view = mount(
      <TriageQuestion
        question={{ id: 'salaryLowerBound', text: 'Сравнивать по нижней границе зарплаты?', number: 1, total: 2 }}
        onAnswer={onAnswer}
      />,
    );
    const group = view.container.querySelector('div.vz-q1')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.querySelector('.vz-q1-n.num')!.textContent).toBe('1 из 2');
    expect(group.querySelector('.vz-q1-t')!.textContent).toContain('Сравнивать по нижней границе зарплаты?');
    const buttons = [...group.querySelectorAll('.vz-q1-a button.btn.is-sm')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Да', 'Нет']);
    click(buttons[0]!);
    click(buttons[1]!);
    expect(onAnswer.mock.calls).toEqual([[true], [false]]);
    view.unmount();
  });
});

describe('полоса действий', () => {
  it('«Скрыть выбранные · N» и «Отмена»', () => {
    const onHide = vi.fn();
    const onCancel = vi.fn();
    const view = mount(<TriageBar count={3} busy={false} onHide={onHide} onCancel={onCancel} />);
    const bar = view.container.querySelector('div.vz-bar')!;
    expect(bar.getAttribute('role')).toBe('group');
    expect(bar.getAttribute('aria-label')).toBe('Помочь выбрать');
    const [primary, cancel] = [...bar.querySelectorAll('button')];
    expect(primary!.className).toContain('is-primary');
    expect(primary!.textContent).toBe('Скрыть выбранные · 3');
    expect(primary!.querySelector('.num')!.textContent).toBe('3');
    click(primary!);
    click(cancel!);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('N = 0: кнопка неактивна', () => {
    const view = mount(<TriageBar count={0} busy={false} onHide={vi.fn()} onCancel={vi.fn()} />);
    expect((view.container.querySelector('.is-primary') as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
  });

  it('идёт скрытие: обе кнопки заняты, серию нельзя бросить на середине', () => {
    const view = mount(<TriageBar count={2} busy onHide={vi.fn()} onCancel={vi.fn()} />);
    const [primary, cancel] = [...view.container.querySelectorAll('button')];
    expect(primary!.disabled).toBe(true);
    expect(primary!.getAttribute('aria-busy')).toBe('true');
    expect(cancel!.disabled).toBe(true);
    view.unmount();
  });

  it('идёт повторный разбор: скрывать по прежним отметкам нельзя, «Отмена» доступна', () => {
    const view = mount(
      <TriageBar count={2} busy={false} loading onHide={vi.fn()} onCancel={vi.fn()} />,
    );
    const [primary, cancel] = [...view.container.querySelectorAll('button')];
    expect(primary!.disabled).toBe(true);
    expect(cancel!.disabled).toBe(false);
    view.unmount();
  });
});

describe('состояния', () => {
  it('«Разбираем N вакансий…»', () => {
    const view = mount(<TriageStatus kind="loading" total={214} />);
    const line = view.container.querySelector('p.vz-st')!;
    expect(line.getAttribute('role')).toBe('status');
    expect(line.getAttribute('aria-busy')).toBe('true');
    expect(line.textContent).toBe('Разбираем 214 вакансий…');
    view.unmount();
  });

  it('склонение: 1 вакансию, 3 вакансии', () => {
    const one = mount(<TriageStatus kind="loading" total={1} />);
    expect(one.container.textContent).toBe('Разбираем 1 вакансию…');
    one.unmount();
    const few = mount(<TriageStatus kind="loading" total={3} />);
    expect(few.container.textContent).toBe('Разбираем 3 вакансии…');
    few.unmount();
  });

  it('«Подборка слабо совпадает · подходит X из N»', () => {
    const view = mount(<TriageStatus kind="weak" keep={6} total={23} />);
    const line = view.container.querySelector('p.vz-st')!;
    expect(line.getAttribute('aria-busy')).toBeNull();
    expect(line.textContent).toBe('Подборка слабо совпадает · подходит 6 из 23');
    view.unmount();
  });

  it('ошибка разбора: «Повторить» на месте', () => {
    const onRetry = vi.fn();
    const view = mount(<TriageError text="Не удалось разобрать подборку" onRetry={onRetry} />);
    expect(view.container.querySelector('.vl-err')!.getAttribute('role')).toBe('alert');
    click(view.container.querySelector('button.row-act'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('Не удалось разобрать подборку');
    view.unmount();
  });
});
