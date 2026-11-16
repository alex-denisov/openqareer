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

describe('CabinetB640 (корень нового кабинета, B649)', () => {
  const html = renderToStaticMarkup(
    <CabinetB640 session={session} onSessionChange={() => undefined} />,
  );

  it('рисуется в своём корневом классе, без классов прежнего кабинета', () => {
    expect(html).toContain('data-testid="cabinet-b640"');
    expect(html).toContain('class="b640"');
    expect(html).not.toContain('career-shell');
  });

  it('показывает заголовок и выход', () => {
    expect(html).toContain('<h1');
    expect(html).toContain('Выйти');
  });

  it('не содержит запрещённых формулировок', () => {
    expect(html).not.toMatch(/пока недоступно|скоро|в разработке/iu);
  });
});
