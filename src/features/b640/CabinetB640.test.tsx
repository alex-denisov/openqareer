import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../coach/coachApi';
import { CabinetB640 } from './CabinetB640';

const session: AuthUser = {
  username: 'flagged.test',
  email: null,
  displayName: 'Мария Соколова',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-1',
  features: { cabinetB640: true },
};

function render(path: string): string {
  return renderToStaticMarkup(
    <CabinetB640
      session={session}
      path={path}
      onNavigate={() => undefined}
      onSessionChange={() => undefined}
    />,
  );
}

describe('CabinetB640 (корень нового кабинета, B649)', () => {
  it('рисуется в своём корневом классе, без классов прежнего кабинета', () => {
    const html = render('/app');
    expect(html).toContain('data-testid="cabinet-b640"');
    expect(html).toContain('class="b640"');
    expect(html).not.toContain('career-shell');
  });

  it('по умолчанию светлая тема, атрибуты корня повторяют макет', () => {
    const html = render('/app/account/connections');
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('data-active="settings"');
    expect(html).toContain('data-template="settings"');
    expect(html).toContain('data-tabs="Разделы аккаунта"');
  });

  it('показывает рейл из шести разделов и «Аккаунта», текущий раздел отмечен', () => {
    const html = render('/app/profile');
    for (const label of ['Сегодня', 'Профиль', 'Карьера', 'Вакансии', 'Отклики', 'Дневник', 'Аккаунт']) {
      expect(html).toContain(`<span>${label}</span>`);
    }
    expect(html).toMatch(
      /<a (?=[^>]*class="nav")(?=[^>]*href="\/app\/profile")(?=[^>]*aria-current="page")/u,
    );
  });

  it('нижняя навигация — четыре раздела и «Ещё»', () => {
    const html = render('/app');
    const bottom = html.slice(html.indexOf('class="bottomnav"'), html.indexOf('class="more-menu"'));
    expect(bottom.match(/<a /gu)).toHaveLength(4);
    expect(bottom).toContain('class="more-btn"');
    expect(bottom).toContain('aria-expanded="false"');
  });

  it('у вложенного экрана есть путь, у раздела с вкладками — вкладки', () => {
    const nested = render('/app/profile/experience/e1');
    expect(nested).toContain('class="crumbs only-desk"');
    expect(nested).toContain('aria-label="Назад: Проверка записей"');
    const tabbed = render('/app/profile/footprint/start');
    expect(tabbed).toContain('aria-label="Разделы профиля"');
    expect(tabbed).toMatch(
      /<a (?=[^>]*href="\/app\/profile\/footprint")(?=[^>]*aria-current="page")[^>]*>Цифровой след/u,
    );
    expect(tabbed).not.toContain('class="crumbs');
  });

  it('чужой адрес под /app показывает страницу «нет» со ссылкой на «Сегодня»', () => {
    const html = render('/app/nope');
    expect(html).toContain('Такой страницы нет');
    expect(html).toContain('href="/app/today"');
  });

  it('адрес консультанта открывает панель над «Сегодня» (B700)', () => {
    const html = render('/app/consultant/history');
    expect(html).toContain('data-active="today"');
    expect(html).toContain('data-dialog="1"');
    expect(html).toContain('class="app has-panel"');
    // При открытой панели кнопки «Консультант» в полосе нет, на 390 она отмечена открытой.
    expect(html).not.toContain('btn-panel');
    expect(html).toMatch(/class="mob-coach"[^>]*aria-expanded="true"/u);
    const plain = render('/app/vacancies');
    expect(plain).toContain('class="app"');
    expect(plain).not.toContain('data-dialog');
    expect(plain).toMatch(/class="btn is-quiet btn-panel"[^>]*href="\/app\/consultant"/u);
    expect(plain).toMatch(/class="mob-coach"[^>]*aria-expanded="false"/u);
  });

  it('над «Все уведомления» вкладки аккаунта, текущая — «Уведомления» (B700)', () => {
    const html = render('/app/notifications');
    expect(html).toContain('data-active="settings"');
    expect(html).toContain('data-tabs="Разделы аккаунта"');
    expect(html).toMatch(
      /<a (?=[^>]*href="\/app\/account\/notifications")(?=[^>]*aria-current="page")[^>]*>Уведомления/u,
    );
  });

  it('вкладка с короткой подписью: остаток виден только на 1440 и 1176 (B700)', () => {
    const html = render('/app/vacancies');
    expect(html).toContain('<span>Компании<span class="only-desk"> и люди</span></span>');
  });

  it('колокольчик без подключённой панели остаётся ссылкой на «Все уведомления»', () => {
    const html = render('/app/vacancies');
    expect(html).toMatch(/class="icon-btn bell"[^>]*href="\/app\/notifications"/u);
    expect(html).not.toContain('aria-controls="notif-pop"');
  });

  it('не содержит запрещённых формулировок', () => {
    expect(render('/app')).not.toMatch(/пока недоступно|скоро|в разработке/iu);
  });
});
