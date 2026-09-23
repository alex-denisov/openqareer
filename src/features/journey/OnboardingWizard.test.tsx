import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingWizard } from './OnboardingWizard';

describe('OnboardingWizard', () => {
  it('opens on the source step with all four mockup cards and a way to defer setup', () => {
    const html = renderToStaticMarkup(<OnboardingWizard onComplete={() => undefined} />);
    expect(html).toContain('С чем разбираемся?');
    expect(html).toContain('Шаг 1 из 6');
    expect(html).toContain('PDF резюме');
    expect(html).toContain('Профиль LinkedIn');
    expect(html).toContain('Резюме на hh.ru');
    expect(html).toContain('Расскажу сам');
    expect(html).toContain('Отложить настройку');
  });

  it('never shows the old career-goal question the mockup dropped', () => {
    const html = renderToStaticMarkup(<OnboardingWizard onComplete={() => undefined} />);
    expect(html).not.toContain('Хочу найти работу');
    expect(html).not.toContain('Не понимаю, какая роль мне подходит');
  });
});
