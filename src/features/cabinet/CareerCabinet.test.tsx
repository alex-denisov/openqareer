import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CareerRoutePremises } from './CareerCabinet';

describe('CareerCabinet route premises', () => {
  it('shows independently reviewable role, geography and work-mode premises', () => {
    const html = renderToStaticMarkup(
      <CareerRoutePremises
        targetRole="Руководитель продукта"
        location="Берлин"
        workMode="remote"
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain('Роль и уровень');
    expect(html).toContain('Руководитель продукта');
    expect(html).toContain('География');
    expect(html).toContain('Берлин');
    expect(html).toContain('Формат работы');
    expect(html).toContain('Удалённо');
    expect(html).toContain('Изменить роль и условия');
  });
});
