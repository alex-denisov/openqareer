import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('классы макета для вариантов', () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" size="sm" icon="check">
        Сохранить
      </Button>,
    );
    expect(html).toContain('class="btn is-primary is-sm"');
    expect(html).toContain('type="button"');
    expect(html).toContain('Сохранить');
  });
  it('quiet и danger', () => {
    expect(renderToStaticMarkup(<Button variant="quiet">a</Button>)).toContain('btn is-quiet');
    expect(renderToStaticMarkup(<Button variant="danger">a</Button>)).toContain('btn is-danger');
  });
  it('ожидание: aria-busy и disabled', () => {
    const html = renderToStaticMarkup(<Button busy>Отправить</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled');
  });
});
