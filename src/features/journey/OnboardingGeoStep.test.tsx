import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingGeoStep, ONBOARDING_FORMAT_OPTIONS } from './OnboardingGeoStep';

const noop = () => undefined;

describe('OnboardingGeoStep', () => {
  it('lists the full region catalogue as chips', () => {
    const html = renderToStaticMarkup(
      <OnboardingGeoStep
        regions={[]}
        prefilledRegion={undefined}
        format={ONBOARDING_FORMAT_OPTIONS[0]}
        onToggleRegion={noop}
        onChangeFormat={noop}
      />,
    );
    expect(html).toContain('Россия');
    expect(html).toContain('СНГ');
    expect(html).toContain('MENA');
  });

  it('marks a region "из LinkedIn" when it was prefilled from an import', () => {
    const html = renderToStaticMarkup(
      <OnboardingGeoStep
        regions={['mena']}
        prefilledRegion="mena"
        format={ONBOARDING_FORMAT_OPTIONS[0]}
        onToggleRegion={noop}
        onChangeFormat={noop}
      />,
    );
    expect(html).toContain('из LinkedIn');
  });

  it('renders the employment-format row as a single-select', () => {
    const html = renderToStaticMarkup(
      <OnboardingGeoStep
        regions={[]}
        prefilledRegion={undefined}
        format="Контракт / interim"
        onToggleRegion={noop}
        onChangeFormat={noop}
      />,
    );
    expect(html).toContain('Полная занятость');
    expect(html).toContain('Консультирование');
  });
});
