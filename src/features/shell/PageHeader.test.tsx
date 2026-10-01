import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the shared page-heading anatomy with an optional action slot', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        kicker="Кампания"
        title="Вакансии"
        description="Отклик оформляется здесь, без перехода на площадку."
        right={<button type="button">Помочь выбрать</button>}
      />,
    );

    expect(html).toContain('class="career-page-header"');
    expect(html).toContain('class="career-page-header-kicker"');
    expect(html).toContain('<h1>Вакансии</h1>');
    expect(html).toContain('Помочь выбрать');
  });

  it('does not render an empty action container without a right slot', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        kicker="Пайплайн"
        title="Отклики"
        description="Все активные отклики в одном месте."
      />,
    );

    expect(html).not.toContain('career-page-header-right');
  });

  it('renders outline consultant button next to title when onAskConsultant is provided', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        kicker="Личный кабинет"
        title="Профиль"
        description="Факты профиля."
        onAskConsultant={() => undefined}
      />,
    );

    expect(html).toContain('career-ask-consultant-btn');
    expect(html).toContain('Спросить консультанта');
  });
});
