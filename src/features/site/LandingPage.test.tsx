import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../coach/coachApi';
import { LANDING_STATS_SNAPSHOT, landingTokenStats } from '../../../shared/landingStats';
import { LandingPage } from './LandingPage';
import { FAQ_GROUPS } from './publicSiteContent';

const candidate = {
  id: 'u1',
  candidateId: 'c1',
  username: 'maria',
  displayName: 'Мария',
  role: 'candidate',
} as unknown as AuthUser;
const admin = { ...candidate, role: 'admin' } as unknown as AuthUser;

function render(session?: AuthUser | null) {
  return renderToStaticMarkup(
    <LandingPage onNavigate={vi.fn()} session={session} stats={LANDING_STATS_SNAPSHOT} />,
  );
}

describe('LandingPage (B535, approved mockup v18)', () => {
  it('leads with the approved hero and both registration actions', () => {
    const html = render();
    expect(html).toContain('Ваш опыт стоит больше, <span>чем видно в резюме</span>');
    expect(html).toContain('Сервис для поиска работы с ИИ');
    expect(html).toContain('подберёт вакансии из всех источников');
    expect(html).toMatch(/href="\/signup" class="ps-btn is-primary is-lg">Найти работу</u);
    expect(html).toMatch(/href="\/signup" class="ps-btn is-lg">Подобрать вакансии</u);
    expect(html).toContain('Загрузить резюме бесплатно');
    expect(html).toContain('href="#download"');
    expect(html).toContain('Скачать приложение');
  });

  it('shows pool numbers with a date and only salaried rows without company names', () => {
    const html = render();
    expect(html).toContain('<b>1,1 млн</b> активных вакансий');
    expect(html).toContain('<b>324</b> источника');
    expect(html).toContain('Пул openqareer, обновлено 20.10.2026');
    for (const row of LANDING_STATS_SNAPSHOT.vacancies) {
      expect(html).toContain(row.title);
      expect(html).toContain(row.salary);
    }
    for (const company of ['Datadog', 'Moderna', 'Reddit', 'Скопа', 'ROSSKO', 'FT capital']) {
      expect(html).not.toContain(company);
    }
  });

  it('prerenders tokens the server replaces, never a stale number', () => {
    const html = renderToStaticMarkup(
      <LandingPage onNavigate={vi.fn()} stats={landingTokenStats()} />,
    );
    expect(html).toContain('%%OQ_ACTIVE%%');
    expect(html).toContain('%%OQ_V0_TITLE%%');
    expect(html).toContain('%%OQ_STATS_JSON%%');
    expect(html).not.toContain('1 119 270');
  });

  it('keeps owner-rejected and unproven wording off the page', () => {
    const html = render();
    for (const banned of [
      '—',
      'квитанц',
      'анонимн',
      'Вход через вашу сессию',
      'человек-эксперт',
      'тянете',
      'Бесплатно и без срока',
      'Найти работу бесплатно',
      'чаще выбирают',
      'в тот же день',
    ]) {
      expect(html, banned).not.toContain(banned);
    }
  });

  it('publishes one organization graph with offers and no FAQPage on the landing', () => {
    const html = render();
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"@id":"https://openqareer.com/#org"');
    expect(html).toContain('"operatingSystem":"Web, macOS"');
    expect(html).toContain('"billingDuration":"P1M"');
    expect(html).toContain('"minPrice":150000');
    expect(html).not.toContain('"@type":"FAQPage"');
    expect(html).not.toContain('Windows"');
  });

  it('shows six landing questions taken verbatim from the /faq set', () => {
    const html = render();
    const all = FAQ_GROUPS.flatMap((group) => group.items);
    const shown = all.filter((item) => html.includes(item.question));
    expect(shown).toHaveLength(6);
    expect(html).toContain('href="/faq"');
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

  it('renders every action as a link, never a styled button', () => {
    for (const html of [render(), render(candidate), render(admin)]) {
      expect(html).not.toMatch(/<button[^>]*class="[^"]*ps-btn/u);
    }
  });
});
