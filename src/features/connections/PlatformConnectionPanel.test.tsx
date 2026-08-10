import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlatformConnectionPanel } from './PlatformConnectionPanel';

describe('PlatformConnectionPanel', () => {
  it('states what a connection reads before the candidate agrees', () => {
    const html = renderToStaticMarkup(
      <PlatformConnectionPanel platform="hh" />,
    );
    expect(html).toMatch(/Подключить hh\.ru/i);
    expect(html).toMatch(/профиль и резюме/i);
    expect(html).toMatch(/не выполняем действий от вашего имени/i);
    expect(html).toMatch(/Ничего не читается до вашего согласия/i);
  });

  it('never implies that LinkedIn brings career history or verifies identity', () => {
    const html = renderToStaticMarkup(
      <PlatformConnectionPanel platform="linkedin" />,
    );
    expect(html).toMatch(/не переносит карьерную историю/i);
    expect(html).toMatch(/не подтверждает личность/i);
    expect(html).toMatch(/экспорт|PDF/i);
  });
});
