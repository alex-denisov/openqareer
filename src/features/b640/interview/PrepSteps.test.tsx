// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ShellProvider } from '../shell/ShellContext';
import { mount, type Mounted } from '../kit/testDom';
import { PrepSteps } from './PrepSteps';

let view: Mounted | null = null;

afterEach(() => {
  view?.unmount();
  view = null;
});

async function render(current: 'prep' | 'debrief') {
  await act(async () => {
    const shell = {
      session: null,
      path: '/app',
      search: '',
      match: null,
      consultantRoute: null,
      navigate: () => undefined,
      signOut: async () => undefined,
      theme: 'light' as const,
      setTheme: () => undefined,
    } as never;
    view = mount(
      <ShellProvider value={shell}>
        <PrepSteps responseId="r1" current={current} />
      </ShellProvider>,
    );
  });
  const links = [...view!.container.querySelectorAll('a')];
  return links.map((link) => ({
    text: link.textContent,
    done: Boolean(link.querySelector('svg, i')),
  }));
}

// B645-2: в макете i04 пройдены «Отклик», «Подготовка» и «Интервью»; на i01/i02 — только «Отклик».
describe('PrepSteps: галочки пройденных шагов', () => {
  it('на разборе отмечены три шага до текущего', async () => {
    expect(await render('debrief')).toEqual([
      { text: 'Отклик', done: true },
      { text: 'Подготовка', done: true },
      { text: 'Интервью', done: true },
      { text: 'Разбор', done: false },
    ]);
  });

  it('на подготовке отмечен только отклик', async () => {
    expect((await render('prep')).map((step) => step.done)).toEqual([true, false, false, false]);
  });

  it('строка прокручена так, что текущий шаг виден целиком', async () => {
    const proto = HTMLElement.prototype;
    const width = Object.getOwnPropertyDescriptor(proto, 'offsetWidth');
    const left = Object.getOwnPropertyDescriptor(proto, 'offsetLeft');
    const client = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 100 });
    Object.defineProperty(proto, 'offsetLeft', {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute('aria-current') === 'page' ? 300 : 0;
      },
    });
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 358 });
    try {
      await render('debrief');
      const row = view!.container.querySelector<HTMLElement>('.sec-tabs-in')!;
      expect(row.scrollLeft).toBe(300 + 100 - 358 + 40);
    } finally {
      if (width) Object.defineProperty(proto, 'offsetWidth', width);
      if (left) Object.defineProperty(proto, 'offsetLeft', left);
      if (client) Object.defineProperty(Element.prototype, 'clientWidth', client);
    }
  });
});
