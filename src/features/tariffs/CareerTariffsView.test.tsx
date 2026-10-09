import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CareerTariffsView } from './CareerTariffsView';
import { TariffMobileView } from './TariffMobileView';
import type { TariffSubscriptionInfo } from './tariffsData';

describe('CareerTariffsView (B442)', () => {
  it('renders all five levels with exact prices and volumes from Mockup 7 (Criterion 1)', () => {
    const html = renderToStaticMarkup(<CareerTariffsView activeTierId="free" />);

    // Five levels and prices
    expect(html).toContain('Free');
    expect(html).toContain('0 ₽');
    expect(html).toContain('Basic');
    expect(html).toContain('3 990 ₽');
    expect(html).toContain('Pro');
    expect(html).toContain('9 900 ₽');
    expect(html).toContain('Max');
    expect(html).toContain('39 900 ₽');
    expect(html).toContain('Executive');
    expect(html).toContain('150–300 тыс. ₽');

    // Volume items
    expect(html).toContain('Профиль из LinkedIn и hh.ru, источник у каждого факта');
    expect(html).toContain('Резюме и письма под вакансии');
    expect(html).toContain('Отправка откликов по вашим правилам');
    expect(html).toContain('Ворота эксперта: резюме перед рассылкой, интервью, оффер');
    expect(html).toContain('Скрытый рынок и рекрутеры');

    // Platform does itself items
    expect(html).toContain('Читает источники и считает совпадение');
    expect(html).toContain('Собирает подборку каждый день');
    expect(html).toContain('Очередь на одобрение и журнал с квитанциями');
    expect(html).toContain('Готовит досье к каждым воротам');
    expect(html).toContain('Заявку рассматривает команда, ответ в течение недели');
  });

  it('marks the current level with text «Ваш тариф», not color alone (Criterion 2)', () => {
    const htmlFree = renderToStaticMarkup(<CareerTariffsView activeTierId="free" />);
    expect(htmlFree).toContain('Ваш тариф');

    const htmlPro = renderToStaticMarkup(<CareerTariffsView activeTierId="pro" />);
    expect(htmlPro).toContain('Ваш тариф');
  });

  it('contains honest action buttons without fake payment and forbids the word «Купить» (Criterion 3)', () => {
    const html = renderToStaticMarkup(<CareerTariffsView activeTierId="free" />);

    expect(html).toContain('Оставить заявку');
    expect(html).toContain('Перейти на Basic');
    expect(html).toContain('Перейти на Pro');
    expect(html).toContain('Перейти на Max');

    // Forbidden action on buttons: no button has «Купить»
    expect(html).not.toMatch(/<button[^>]*>[^<]*Купить[^<]*<\/button>/i);
    expect(html).not.toMatch(/<a[^>]*>[^<]*Купить[^<]*<\/a>/i);
  });

  it('contains no forbidden technical words (tokens, proxy, pools, limits) (Criterion 4)', () => {
    const html = renderToStaticMarkup(<CareerTariffsView activeTierId="free" />);
    const lower = html.toLowerCase();

    expect(lower).not.toContain('токен');
    expect(lower).not.toContain('прокси');
    expect(lower).not.toContain('серверные пулы');
    expect(lower).not.toContain('лимиты моделей');
  });

  it('renders 390 mobile views: home rows, level details, and comparison (Criterion 5)', () => {
    // 1. Mobile Home view
    const homeHtml = renderToStaticMarkup(
      <TariffMobileView activeTierId="free" initialView="home" />,
    );
    expect(homeHtml).toContain('data-mv="home"');
    expect(homeHtml).toContain('data-go="lvl-free"');
    expect(homeHtml).toContain('data-go="lvl-pro"');
    expect(homeHtml).toContain('data-go="cmp"');
    expect(homeHtml).toContain('Сравнить по шагам пути');

    // 2. Mobile Level detail view
    const detailHtml = renderToStaticMarkup(
      <TariffMobileView activeTierId="free" initialView="lvl-pro" />,
    );
    expect(detailHtml).toContain('data-mv="lvl-pro"');
    expect(detailHtml).toContain('Назад к списку тарифов');
    expect(detailHtml).toContain('Перейти на Pro');
    expect(detailHtml).toContain('Платформа делает сама');

    // 3. Mobile Comparison view
    const cmpHtml = renderToStaticMarkup(
      <TariffMobileView activeTierId="free" initialView="cmp" />,
    );
    expect(cmpHtml).toContain('data-mv="cmp"');
    expect(cmpHtml).toContain('Назад к тарифам');
    expect(cmpHtml).toContain('Уже на Free');
    expect(cmpHtml).toContain('С уровня Basic');
    expect(cmpHtml).toContain('С уровня Pro');
    expect(cmpHtml).toContain('С уровня Max');
    expect(cmpHtml).toContain('С уровня Executive');
  });

  it('renders Pro subscription block only when subscription data is provided (Criterion 3 requirement)', () => {
    const withoutSub = renderToStaticMarkup(<CareerTariffsView activeTierId="pro" />);
    expect(withoutSub).not.toContain('Действует до');

    const sampleSub: TariffSubscriptionInfo = {
      activeUntil: '08.11',
      autoRenew: true,
      amount: '9 900 ₽',
      nextChargeDate: '08.11',
      paymentMethod: 'Карта РФ или СБП',
      todayUsage: { used: 27, total: 35 },
    };

    const withSub = renderToStaticMarkup(
      <CareerTariffsView activeTierId="pro" subscription={sampleSub} />,
    );
    expect(withSub).toContain('Действует до');
    expect(withSub).toContain('08.11');
    expect(withSub).toContain('Автопродление');
    expect(withSub).toContain('Отправок 27 из 35');
  });

  it('contains comparison table with steps and here marker', () => {
    const html = renderToStaticMarkup(<CareerTariffsView activeTierId="free" />);
    expect(html).toContain('Сравнить уровни по шагам пути');
    expect(html).toContain('Профиль с источниками');
    expect(html).toContain('Отклики: черновики в очередь (вы здесь)');
    expect(html).toContain('Скрытый рынок и представления через связи');
  });
});
