import { describe, expect, it } from 'vitest';
import {
  connectorInspectionScript,
  fillConnectorInspectionScript,
} from './connectorInspectionScript';
import { HH_SELECTORS } from './hhSelectors';

describe('shared connector inspection script', () => {
  it('fills in the same two values the desktop shell fills in', () => {
    const script = connectorInspectionScript('hh');

    expect(script).toContain(JSON.stringify('hh'));
    expect(script).toContain(
      JSON.stringify(HH_SELECTORS.security.applicantProfile),
    );
    expect(script).not.toContain('__OPENQAREER_');
  });

  it('stays one evaluable expression for both platforms', () => {
    for (const platform of ['hh', 'linkedin'] as const) {
      expect(() =>
        // Parsing only: the body needs a real document, which it never gets here.
        Function(`return ${connectorInspectionScript(platform)};`),
      ).not.toThrow();
    }
  });

  it('refuses a recogniser it cannot fill instead of guessing', () => {
    expect(() =>
      fillConnectorInspectionScript('(function(){return null;})()', 'hh'),
    ).toThrow('connector_inspection_script_placeholders_missing');
    expect(() =>
      fillConnectorInspectionScript('__OPENQAREER_PLATFORM__', 'hh'),
    ).toThrow('connector_inspection_script_placeholders_missing');
  });

  it('recognises the modern LinkedIn profile navigation marker after login', () => {
    const script = connectorInspectionScript('linkedin');
    const inspect = new Function(
      'document',
      'location',
      `return (${script});`,
    ) as (
      document: {
        readyState: string;
        title: string;
        body: { innerText: string };
        querySelector: (selector: string) => object | null;
      },
      location: { pathname: string; href: string },
    ) => { signedInApplicant: boolean };

    const report = inspect(
      {
        readyState: 'complete',
        title: 'LinkedIn',
        body: { innerText: 'Alexey Denisov' },
        querySelector: (selector) =>
          selector.includes('data-test-id="nav-profile"') ? {} : null,
      },
      { pathname: '/in/me/', href: 'https://www.linkedin.com/in/me/' },
    );

    expect(report.signedInApplicant).toBe(true);
  });
});
