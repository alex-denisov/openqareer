// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { GrowthScreen } from './GrowthScreen';

const openConsultant = vi.hoisted(() => vi.fn());
vi.mock('../shell/ShellContext', () => ({
  useShell: () => ({ openConsultant }),
  useScreenChrome: () => undefined,
}));
vi.mock('../today/useLoad', () => ({
  useLoad: () => ({
    state: 'ready',
    retry: () => undefined,
    data: {
      state: 'ready',
      company: 'Вектор Банк',
      title: 'Руководитель разработки',
      goal: { kind: 'promotion', chosenAt: '2026-01-12T10:00:00.000Z' },
      steps: [],
      arguments: [],
      wage: null,
    },
  }),
}));

let view: Mounted | null = null;
afterEach(() => view?.unmount());

describe('S12 «Работаю»: действия цели по макету', () => {
  it('одна кнопка «Подготовить разговор о повышении», без «Сменить цель»; ведёт к консультанту', () => {
    view = mount(<GrowthScreen node={nodeByCode('s12')!} />);
    const lead = view.container.querySelector('section.lead');
    const buttons = [...(lead?.querySelectorAll('.actions .btn') ?? [])];
    expect(buttons.map((item) => item.textContent)).toEqual(['Подготовить разговор о повышении']);
    expect(buttons[0]?.className).toBe('btn is-primary');
    click(buttons[0] ?? null);
    expect(openConsultant).toHaveBeenCalledOnce();
  });
});
