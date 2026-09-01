import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerTariffsView } from './CareerTariffsView';
import { CURRENT_PLAN, tariffPackages } from './tariffPackages';

/**
 * Экран открывался на «Настройке поиска» — платном тарифе, который никто не
 * подключал и подключить нельзя: оплаты в продукте нет. Кандидат видел чужой
 * план выбранным и ни слова о том, на чём он на самом деле.
 */
describe('CareerTariffsView', () => {
  const html = renderToStaticMarkup(
    <CareerTariffsView onOpenCoach={() => undefined} />,
  );

  it('открывается на плане, который у кандидата действительно есть', () => {
    expect(html).toContain(CURRENT_PLAN.name);
    expect(html).toContain('Ваш план сейчас');
  });

  it('не выдаёт платный тариф за выбранный', () => {
    const paid = tariffPackages.find((plan) => plan.id === 'setup')!;
    const selected = html.match(/is-selected[^]*?<\/button>/u)?.[0] ?? '';

    expect(selected).toContain(CURRENT_PLAN.name);
    expect(selected).not.toContain(paid.name);
  });

  it('говорит прямо, что оплата не подключена', () => {
    expect(html).toContain('Оплата не подключена');
  });
});
