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

  it('не содержит запрещённых формулировок', () => {
    expect(render('/app')).not.toMatch(/пока недоступно|скоро|в разработке/iu);
  });
});
