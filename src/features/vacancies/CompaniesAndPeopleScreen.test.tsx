// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { usePageTitleOverrideValue } from '../shell/pageTitleOverride';
import { CompaniesAndPeopleScreen } from './CompaniesAndPeopleScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./candidateCompaniesApi', () => ({
  getCandidateCompanyPage: () => new Promise(() => undefined),
  getCandidateCompanyDetails: () => new Promise(() => undefined),
  removeCandidateCompanyWant: vi.fn(),
  searchCandidateCompanyRecruiter: vi.fn(),
  setCandidateCompanyWant: vi.fn(),
}));

function TitleProbe() {
  return <h1>{usePageTitleOverrideValue() ?? 'none'}</h1>;
}

describe('CompaniesAndPeopleScreen', () => {
  it('names the page «Компании и люди» while it is open (mockup 13)', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() =>
      root.render(
        <>
          <TitleProbe />
          <CompaniesAndPeopleScreen />
        </>,
      ),
    );
    expect(host.querySelector('h1')?.textContent).toBe('Компании и люди');
    act(() => root.render(<TitleProbe />));
    expect(host.querySelector('h1')?.textContent).toBe('none');
    act(() => root.unmount());
  });
});
