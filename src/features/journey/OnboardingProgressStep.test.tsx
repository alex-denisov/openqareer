import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingProgressStep } from './OnboardingProgressStep';

describe('OnboardingProgressStep', () => {
  it('shows the real counts once parsing has finished — loading state along the way', () => {
    const html = renderToStaticMarkup(
      <OnboardingProgressStep
        busy
        counts={{ jobCount: 0, hasEducation: false, hasSkills: false, totalBullets: 0, bulletsWithNumber: 0 }}
      />,
    );
    expect(html).toContain('Читаем файл');
  });

  it('reports the file and the numeric-evidence ratio once done', () => {
    const html = renderToStaticMarkup(
      <OnboardingProgressStep
        busy={false}
        counts={{ jobCount: 6, hasEducation: true, hasSkills: true, totalBullets: 27, bulletsWithNumber: 16 }}
      />,
    );
    expect(html).toContain('6 мест работы');
    expect(html).toContain('16 из 27');
  });

  it('is honest about an empty document instead of claiming progress', () => {
    const html = renderToStaticMarkup(
      <OnboardingProgressStep
        busy={false}
        counts={{ jobCount: 0, hasEducation: false, hasSkills: false, totalBullets: 0, bulletsWithNumber: 0 }}
      />,
    );
    expect(html).toContain('не нашли структурированных разделов');
  });

  it('surfaces a parse failure as an error row, not a stuck spinner', () => {
    const html = renderToStaticMarkup(
      <OnboardingProgressStep
        busy={false}
        error="Прочитать PDF не удалось."
        counts={{ jobCount: 0, hasEducation: false, hasSkills: false, totalBullets: 0, bulletsWithNumber: 0 }}
      />,
    );
    expect(html).toContain('Прочитать PDF не удалось.');
  });
});
