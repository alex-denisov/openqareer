import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingWizardChrome } from './OnboardingWizardChrome';

const noop = () => undefined;

describe('OnboardingWizardChrome', () => {
  it('always renders all six dots, marking done/current relative to the step', () => {
    const html = renderToStaticMarkup(
      <OnboardingWizardChrome
        step={{ id: 'review', dot: 3, total: 6 }}
        title="Проверьте профиль"
        description="Подтвердите одним экраном."
        onSkip={noop}
      />,
    );
    expect(html).toContain('Шаг 3 из 6');
    expect((html.match(/is-done/g) ?? []).length).toBe(2);
    expect((html.match(/is-current/g) ?? []).length).toBe(1);
  });

  it('always offers the deferral exit', () => {
    const html = renderToStaticMarkup(
      <OnboardingWizardChrome
        step={{ id: 'source', dot: 1, total: 6 }}
        title="С чем разбираемся?"
        description="Выберите то, что у вас уже есть."
        onSkip={noop}
      />,
    );
    expect(html).toContain('Отложить настройку');
  });

  // B249: the shell hides its own rail while onboarding is running (the
  // mockup is full-screen, onboarding.html), so the wordmark has to live
  // here instead.
  it('carries its own wordmark now that the shell rail is hidden', () => {
    const html = renderToStaticMarkup(
      <OnboardingWizardChrome
        step={{ id: 'source', dot: 1, total: 6 }}
        title="С чем разбираемся?"
        description="Выберите то, что у вас уже есть."
        onSkip={noop}
      />,
    );
    expect(html).toContain('brand-lockup');
    expect(html).toContain('aria-label="openqareer, главная"');
  });
});
