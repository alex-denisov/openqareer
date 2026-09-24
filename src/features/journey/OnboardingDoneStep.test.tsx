import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingDoneStep } from './OnboardingDoneStep';

describe('OnboardingDoneStep', () => {
  it('names the campaign role and the elapsed time, matching the mockup wording', () => {
    const html = renderToStaticMarkup(
      <OnboardingDoneStep roleTitle="VP Technology Ops" durationLabel="4 минуты 40 секунд" />,
    );
    expect(html).toContain('VP Technology Ops');
    expect(html).toContain('4 минуты 40 секунд с начала');
  });

  it('is honest when no role was selected instead of naming one that never was', () => {
    const html = renderToStaticMarkup(
      <OnboardingDoneStep roleTitle={undefined} durationLabel="2 минуты 0 секунд" />,
    );
    expect(html).toContain('Роль ещё не выбрана');
  });
});
