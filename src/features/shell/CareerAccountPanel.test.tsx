import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerAccountPanel } from './CareerAccountPanel';

/**
 * B248 (owner decision 2026-09-23) — «Тарифы» moved out of the rail into
 * this panel, opened from the single avatar button. It stays a link to the
 * existing full-screen «Тарифы» screen, not a duplicate of it.
 */
describe('CareerAccountPanel tariffs entry point', () => {
  it('opens tariffs when the diagnostic already produced a career picture', () => {
    const html = renderToStaticMarkup(
      <CareerAccountPanel
        initialUser={null}
        onClose={() => undefined}
        onIdentityChange={() => undefined}
        onOpenTariffs={() => undefined}
        tariffsAvailable
        tariffsPlanName="Самостоятельно"
      />,
    );

    const button = /<button[^>]*class="career-account-tariffs-button"[^>]*>/u.exec(html)?.[0];
    expect(button, 'renders the tariffs button').toBeDefined();
    expect(button).not.toContain('disabled');
    expect(html).toContain('план «Самостоятельно»');
  });

  it('closes tariffs with an honest reason until the diagnostic is finished', () => {
    const html = renderToStaticMarkup(
      <CareerAccountPanel
        initialUser={null}
        onClose={() => undefined}
        onIdentityChange={() => undefined}
        onOpenTariffs={() => undefined}
        tariffsAvailable={false}
        tariffsLockedReason="Завершите карьерную диагностику, чтобы открыть раздел"
        tariffsPlanName="Самостоятельно"
      />,
    );

    const button = /<button[^>]*class="career-account-tariffs-button"[^>]*>/u.exec(html)?.[0];
    expect(button).toContain('disabled');
    expect(button).toContain('Завершите карьерную диагностику');
  });

  it('renders nothing extra when the shell has not wired tariffs in yet', () => {
    const html = renderToStaticMarkup(
      <CareerAccountPanel
        initialUser={null}
        onClose={() => undefined}
        onIdentityChange={() => undefined}
      />,
    );

    expect(html).not.toContain('career-account-tariffs-button');
  });
});

describe('CareerAccountPanel initial section (B266)', () => {
  const user = {
    username: 'jordan',
    email: 'jordan@example.com',
    displayName: 'Jordan Rivers',
    role: 'candidate',
    isTest: true,
    candidateId: 'c-1',
  } as const;

  it('opens on «Подключения» when the profile asks for a re-import', () => {
    const html = renderToStaticMarkup(
      <CareerAccountPanel
        initialUser={user as never}
        initialSection="connections"
        onClose={() => undefined}
        onIdentityChange={() => undefined}
      />,
    );
    const active = /<button[^>]*class="is-active"[^>]*>([^<]*)</u.exec(html)?.[1];
    expect(active).toBe('Подключения');
  });
});
