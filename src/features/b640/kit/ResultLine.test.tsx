import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResultLine, StatusLine } from './ResultLine';

describe('ResultLine', () => {
  it('строка результата с «Отменить»', () => {
    const html = renderToStaticMarkup(<ResultLine text="Применено" onUndo={() => undefined} />);
    expect(html).toContain('<p class="res-row" role="status">');
    expect(html).toContain('<span class="res-t">Применено</span>');
    expect(html).toContain('<button class="res-act" type="button">Отменить</button>');
  });
  it('без отмены кнопки нет', () => {
    expect(renderToStaticMarkup(<ResultLine text="Применено" />)).not.toContain('res-act');
  });
});

describe('StatusLine', () => {
  it('ожидание', () => {
    const html = renderToStaticMarkup(<StatusLine state="wait" text="Ждём ответа" />);
    expect(html).toContain('class="re-line"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
  it('успех', () => {
    expect(renderToStaticMarkup(<StatusLine state="ok" text="Отправлено" />)).toContain('re-line is-ok');
  });
  it('ошибка: role=alert и действие', () => {
    const html = renderToStaticMarkup(
      <StatusLine state="err" text="Не отправлен" action={<button type="button">Повторить</button>} />,
    );
    expect(html).toContain('re-line is-err');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Повторить');
  });
});
