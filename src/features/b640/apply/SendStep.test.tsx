// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../shell/ShellContext', () => ({
  useShell: () => ({ path: '/', navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));

const { SendStep } = await import('./SendStep');

const step = (sentId?: string) => (
  <SendStep
    vacancyId="cluster-1"
    head={{
      title: 'Руководитель',
      company: 'ЭР-Телеком',
      url: 'https://hh.ru/vacancy/139105692',
      source: 'hh.ru',
      platform: { label: 'hh.ru', site: false },
      sentId,
    }}
    sourceType="hh"
    approved={null}
    letterText="Письмо"
    form={null}
    onForm={async () => undefined}
    onLetter={() => undefined}
  />
);
const render = (sentId?: string) => renderToStaticMarkup(step(sentId));

describe('B678: «Отправка» отклика, который уже ушёл', () => {
  it('называет площадку отправки и не предлагает отправить снова', () => {
    const html = render('application-1');
    expect(html).toContain('Отправлен через hh.ru');
    expect(html).toContain('К отклику');
    expect(html).not.toContain('Я откликнулся');
    expect(html).not.toContain('Открыть вакансию на сайте');
  });

  it('неотправленному показывает шаг отправки', () => {
    expect(render()).not.toContain('Отправлен через');
  });

  it('отправленный на открытом шаге оставляет итог шага', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(step()));
    const before = host.innerHTML;
    act(() => root.render(step('application-1')));
    expect(host.innerHTML).toBe(before);
    expect(host.textContent).not.toContain('Отправлен через');
    act(() => root.unmount());
  });
});
