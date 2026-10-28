import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../coach/coachApi';
import { LegalDocumentPage } from '../legal/LegalDocumentPage';
import { CountryFitPage } from './CountryFitPage';
import { FaqPage } from './FaqPage';
import { LandingPage } from './LandingPage';
import { NotFoundPage, SupportPage } from './PublicHelpPages';
import { RelocationPage } from './RelocationPage';
import { ResumeBuilderPage } from './resumeBuilder/ResumeBuilderPage';
import { SalaryCalculatorPage } from './SalaryCalculatorPage';
import { TariffsPage } from './TariffsPage';

/**
 * B577 guard: a public page draws the same markup for a guest, a candidate and
 * an administrator. Session-specific variants are all in the markup and CSS
 * picks one by the marks oq-auth-2.js puts on <html>, so the session answer
 * never redraws the page.
 */
type Viewer = { readonly signedIn: boolean; readonly isAdmin: boolean };

const VIEWERS: readonly Viewer[] = [
  { signedIn: false, isAdmin: false },
  { signedIn: true, isAdmin: false },
  { signedIn: true, isAdmin: true },
];

function sessionOf({ signedIn, isAdmin }: Viewer): AuthUser | null {
  if (!signedIn) return null;
  return {
    username: 'maria',
    email: null,
    displayName: 'Мария',
    role: isAdmin ? 'admin' : 'candidate',
    isTest: true,
    candidateId: 'c1',
  };
}

const onNavigate = vi.fn();

const PAGES: ReadonlyArray<readonly [string, (viewer: Viewer) => ReactElement]> = [
  ['landing', (v) => <LandingPage onNavigate={onNavigate} session={sessionOf(v)} />],
  ['country-fit', (v) => <CountryFitPage onNavigate={onNavigate} {...v} />],
  ['relocation', (v) => <RelocationPage onNavigate={onNavigate} {...v} />],
  ['salary-calculator', (v) => <SalaryCalculatorPage onNavigate={onNavigate} {...v} />],
  ['resume-builder', (v) => <ResumeBuilderPage onNavigate={onNavigate} {...v} />],
  ['faq', (v) => <FaqPage onNavigate={onNavigate} {...v} />],
  ['tariffs', (v) => <TariffsPage onNavigate={onNavigate} {...v} />],
  ['support', (v) => <SupportPage onNavigate={onNavigate} {...v} />],
  ['not-found', (v) => <NotFoundPage onNavigate={onNavigate} {...v} />],
  ['legal', (v) => <LegalDocumentPage slug="terms" onNavigate={onNavigate} {...v} />],
];

describe('public pages do not depend on the session (B577)', () => {
  it.each(PAGES)('%s draws one markup for guest, candidate and admin', (_name, page) => {
    const [guest, ...others] = VIEWERS.map((viewer) => renderToStaticMarkup(page(viewer)));
    for (const html of others) expect(html).toBe(guest);
  });
});
