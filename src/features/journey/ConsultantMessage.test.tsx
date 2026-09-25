import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsultantMessage } from './ConsultantMessage';

function render(text: string): string {
  return renderToStaticMarkup(<ConsultantMessage text={text} />);
}

describe('ConsultantMessage markdown (B266)', () => {
  it('renders bold, italic and inline code instead of showing the markers', () => {
    const html = render('Сначала **обновите заголовок**, затем *проверьте* `About`.');
    expect(html).toBe(
      '<p>Сначала <strong>обновите заголовок</strong>, затем <em>проверьте</em> <code>About</code>.</p>',
    );
  });

  it('turns dash and numbered lines into lists', () => {
    expect(render('Шаги:\n- первый\n- второй')).toBe(
      '<p>Шаги:</p><ul><li>первый</li><li>второй</li></ul>',
    );
    expect(render('1. Резюме\n2) Письмо')).toBe('<ol><li>Резюме</li><li>Письмо</li></ol>');
  });

  it('renders a heading line as a strong paragraph, not as «###»', () => {
    expect(render('### План на неделю\nТекст')).toBe(
      '<p class="career-dialogue-heading"><strong>План на неделю</strong></p><p>Текст</p>',
    );
  });

  it('never produces live markup from the model text', () => {
    const html = render('<img src=x onerror=alert(1)> [ссылка](javascript:alert(1))');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href');
    expect(html).toContain('&lt;img');
  });

  it('leaves a lone asterisk and snake_case words alone', () => {
    expect(render('2 * 3 и my_file_name')).toBe('<p>2 * 3 и my_file_name</p>');
  });
});
