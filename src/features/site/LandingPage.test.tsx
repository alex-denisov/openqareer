import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../coach/coachApi';
import {
  LANDING_STATS_SNAPSHOT,
  applyLandingStats,
  landingTokenStats,
  type LandingStats,
} from '../../../shared/landingStats';
import { LandingPage } from './LandingPage';
import { HOME_TIERS } from './landingHomeContent';
import { TARIFF_LEVELS } from '../tariffs/tariffsData';

const candidate = {
  id: 'u1',
  candidateId: 'c1',
  username: 'maria',
  displayName: 'Мария',
  role: 'candidate',
} as unknown as AuthUser;
const admin = { ...candidate, role: 'admin' } as unknown as AuthUser;

const FEED_STATS: LandingStats = {
  ...LANDING_STATS_SNAPSHOT,
  feed: Array.from({ length: 12 }, (_, index) => ({
    title: `Бухгалтер ${index}`,
    salary: '120–140 тыс. ₽ в месяц',
    meta: 'Москва · hh.ru · 26.10',
    href: `/vacancies/job/accountant-${index}`,
  })),
};

function render(session?: AuthUser | null, stats: LandingStats = FEED_STATS) {
  return renderToStaticMarkup(<LandingPage onNavigate={vi.fn()} session={session} stats={stats} />);
}

describe('LandingPage (B569, mockup 01-home)', () => {
  it('leads with the approved hero, lead and both actions', () => {
    const html = render();
    expect(html).toContain('Вы выбираете работу. <span>Резюме, поиск и отклики — на нас</span>');
    expect(html).toContain('Поиск работы с ИИ: openqareer соберёт сильное резюме');
    expect(html).toMatch(/href="\/signup\?from=home" class="btn primary lg">Найти работу</u);
    expect(html).toMatch(/class="btn lg" href="\/vacancies">Смотреть вакансии</u);
    expect(html).toContain('Скачать для');
    expect(html).toContain('/downloads/openqareer-macos.dmg');
    expect(html).toContain('/downloads/openqareer-windows.exe');
    expect(html.match(/class="macbadge"/gu)).toHaveLength(4);
  });

  it('has the six screens of the mockup and the tools anchor', () => {
    const html = render();
    expect(html.match(/class="scr[ "]/gu)).toHaveLength(6);
    expect(html).toContain('id="tools"');
    expect(html).toContain('Бесплатные инструменты для поиска работы');
    for (const href of ['/tools/salary-calculator', '/tools/resume', '/salaries', '/vacancies']) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('counts unique vacancies with a date, never the 1.1 million records', () => {
    const html = render();
    expect(html).toContain('<b>712 тыс.</b> вакансий');
    expect(html).toContain('· обновлено 26.10.2026');
    expect(html).not.toContain('1,1 млн');
    expect(html).toContain('и ещё 320');
  });

  it('feeds five rows that link to public catalog cards, with a pause button', () => {
    const html = render();
    expect(html.match(/<a href="\/vacancies\/job\/accountant-\d+">/gu)).toHaveLength(5);
    expect(html).toContain('Бухгалтер 0');
    expect(html).toContain('Москва · hh.ru · 26.10');
    expect(html).toContain('aria-pressed="false">Пауза</button>');
  });

  it('falls back to the snapshot rows, linked to the catalog, before the first reading', () => {
    const html = render(undefined, LANDING_STATS_SNAPSHOT);
    expect(html).toContain(LANDING_STATS_SNAPSHOT.vacancies[0]?.title);
    expect(html).toContain('<a href="/vacancies">');
  });

  it('prerenders tokens the server replaces, never a stale number', () => {
    const html = renderToStaticMarkup(
      <LandingPage onNavigate={vi.fn()} stats={landingTokenStats()} />,
    );
    for (const token of [
      '%%OQ_ACTIVE%%',
      '%%OQ_F0_HREF%%',
      '%%OQ_SOURCES_MORE%%',
      '%%OQ_STATS_JSON%%',
    ]) {
      expect(html).toContain(token);
    }
    const served = applyLandingStats(html, FEED_STATS);
    expect(served).not.toContain('%%OQ_');
    expect(served).toContain('href="/vacancies/job/accountant-0"');
    expect(served).toContain('712 тыс.');
  });

  it('shows the tariffs of tariffsData in order, Pro recommended first on a phone', () => {
    const html = render();
    expect(HOME_TIERS.map((tier) => tier.name)).toEqual(TARIFF_LEVELS.map((level) => level.name));
    expect(html).toContain('<span class="chip blue">Рекомендуем</span>');
    expect(html).toMatch(
      /class="btn primary" href="\/signup\?plan=pro&amp;from=home">Выбрать Pro</u,
    );
    expect(html).toContain('9 900 ₽');
    expect(html).toContain('от 150 тыс. ₽');
    expect(html.match(/aria-label="(Free|Basic|Pro|Max|Executive)"/gu)).toHaveLength(5);
    expect(html).not.toMatch(/пробн|24 час|без карты|возврат/iu);
  });

  it('keeps eight questions with links and the Mac app card', () => {
    const html = render();
    expect(html.match(/<details class="q">/gu)).toHaveLength(8);
    expect(html).toContain('href="/faq"');
    expect(html).toContain('Больше функций доступно в приложении');
  });

  it('publishes one organization graph with offers and no FAQPage', () => {
    const html = render();
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"operatingSystem":"Web, macOS, Windows"');
    expect(html).toContain('"minPrice":150000');
    expect(html).not.toContain('"@type":"FAQPage"');
  });

  it('switches the header to the cabinet for a signed-in candidate', () => {
    const html = render(candidate);
    expect(html).toContain('Открыть кабинет');
    expect(html).toContain('href="/app"');
    expect(html).not.toContain('Администрирование');
  });

  it('adds the console link for an administrator', () => {
    const html = render(admin);
    expect(html).toContain('Администрирование');
    expect(html).toContain('href="/admin"');
  });
});
