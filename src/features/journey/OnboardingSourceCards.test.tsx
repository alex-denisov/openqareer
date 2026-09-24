import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingSourceCards } from './OnboardingSourceCards';

const noop = () => undefined;

describe('OnboardingSourceCards', () => {
  it('renders the four mockup cards: PDF, LinkedIn, hh.ru, tell it myself', () => {
    const html = renderToStaticMarkup(
      <OnboardingSourceCards
        active="pdf"
        linkedinSelected={false}
        hhSelected={false}
        onChoosePdf={noop}
        onChooseLinkedin={noop}
        onChooseHh={noop}
        onChooseTalk={noop}
      />,
    );
    expect(html).toContain('PDF резюме');
    expect(html).toContain('Профиль LinkedIn');
    expect(html).toContain('Резюме на hh.ru');
    expect(html).toContain('Расскажу сам');
  });

  it('marks the active card selected with aria-pressed', () => {
    const html = renderToStaticMarkup(
      <OnboardingSourceCards
        active="pdf"
        linkedinSelected={false}
        hhSelected={false}
        onChoosePdf={noop}
        onChooseLinkedin={noop}
        onChooseHh={noop}
        onChooseTalk={noop}
      />,
    );
    expect(html).toMatch(/is-selected[^>]*>[\s\S]*?PDF резюме/);
  });

  it('shuts the other cards once a source is captured, naming why', () => {
    const html = renderToStaticMarkup(
      <OnboardingSourceCards
        active="pdf"
        linkedinSelected={false}
        hhSelected={false}
        lockedTo="pdf"
        lockReason="PDF уже прочитан."
        onChoosePdf={noop}
        onChooseLinkedin={noop}
        onChooseHh={noop}
        onChooseTalk={noop}
      />,
    );
    const linkedinButtonMatch = html.match(
      /<button[^>]*>[\s\S]*?Профиль LinkedIn[\s\S]*?<\/button>/,
    );
    expect(linkedinButtonMatch?.[0]).toContain('aria-disabled="true"');
    expect(linkedinButtonMatch?.[0]).toContain('title="PDF уже прочитан."');
  });

  it('reflects a connected LinkedIn profile even while the source is generically "profile-import"', () => {
    const html = renderToStaticMarkup(
      <OnboardingSourceCards
        active="profile-import"
        linkedinSelected
        hhSelected={false}
        onChoosePdf={noop}
        onChooseLinkedin={noop}
        onChooseHh={noop}
        onChooseTalk={noop}
      />,
    );
    const linkedinButtonMatch = html.match(/<button[^>]*>[\s\S]*?Профиль LinkedIn[\s\S]*?<\/button>/);
    const hhButtonMatch = html.match(/<button[^>]*>[\s\S]*?Резюме на hh\.ru[\s\S]*?<\/button>/);
    expect(linkedinButtonMatch?.[0]).toContain('aria-pressed="true"');
    expect(hhButtonMatch?.[0]).toContain('aria-pressed="false"');
  });
});
