// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { mount } from '../kit/testDom';
import { TrainingUpgrade } from './TrainingUpgrade';

vi.mock('../shell/ShellContext', () => ({ useShell: () => ({ navigate: vi.fn() }) }));

it('B801 t04: пробные интервью — с Basic, главная кнопка ведёт на оплату тарифа', () => {
  const view = mount(<TrainingUpgrade planId="basic" />);
  expect(view.container.querySelector('.pm-hint > span')!.textContent).toBe(
    'Пробные интервью — с Basic · 10 в месяц',
  );
  const link = view.container.querySelector('a.btn.is-primary')!;
  expect(link.textContent).toBe('Перейти на Basic');
  expect(link.getAttribute('href')).toContain('pay=basic');
  view.unmount();
});
