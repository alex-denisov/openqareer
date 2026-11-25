import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScreenLoading } from './ScreenLoading';
import { ShellProvider } from './ShellContext';

const vacancy = { vacancyId: 'v1', title: 'CTO', company: 'Гринкод' };

function render(code: string, known: boolean): string {
  const value = { path: '/app/responses/v1', journey: known ? { vacancy } : {} } as never;
  return renderToStaticMarkup(
    <ShellProvider value={value}>
      <ScreenLoading code={code} />
    </ShellProvider>,
  );
}

describe('ожидание кода экрана (B798)', () => {
  it('отклик: название из списка — сразу', () => {
    expect(render('o02', true)).toContain('CTO · Гринкод');
  });

  it('название неизвестно или другой экран — место страницы без текста', () => {
    for (const html of [render('o02', false), render('s01', true)]) {
      expect(html).toBe('<div class="page b640-loading" aria-busy="true"></div>');
    }
  });
});
