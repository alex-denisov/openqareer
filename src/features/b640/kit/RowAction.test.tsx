import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RowAction } from './RowAction';

describe('RowAction', () => {
  it('кнопка с вариантами', () => {
    const html = renderToStaticMarkup(
      <RowAction icon="trash" small danger onClick={() => undefined}>
        Удалить
      </RowAction>,
    );
    expect(html).toContain('<button');
    expect(html).toContain('class="row-act is-sm is-danger"');
    expect(html).toContain('Удалить');
  });
  it('ссылка с href', () => {
    const html = renderToStaticMarkup(
      <RowAction icon="right" href="/app/vacancies" neutral>
        Открыть
      </RowAction>,
    );
    expect(html).toContain('<a');
    expect(html).toContain('class="row-act is-neutral"');
    expect(html).toContain('href="/app/vacancies"');
  });
});
