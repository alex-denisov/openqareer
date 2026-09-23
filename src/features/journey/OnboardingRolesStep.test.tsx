import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingRolesStep } from './OnboardingRolesStep';

const noop = () => undefined;

describe('OnboardingRolesStep', () => {
  it('shows a card per role with its evidence tags and a way to select it', () => {
    const html = renderToStaticMarkup(
      <OnboardingRolesStep
        cards={[
          { id: 'role-0', title: 'VP of Technology Operations', evidenceTags: ['P&L $40M+'] },
        ]}
        selectedIds={['role-0']}
        onToggle={noop}
      />,
    );
    expect(html).toContain('VP of Technology Operations');
    expect(html).toContain('P&amp;L $40M+');
    expect(html).toMatch(/is-selected/);
  });

  it('marks a role a hypothesis once its count is below the significance threshold', () => {
    const html = renderToStaticMarkup(
      <OnboardingRolesStep
        cards={[
          {
            id: 'role-2',
            title: 'Chief Operating Officer',
            vacancyCount: 6,
            isHypothesis: true,
            evidenceTags: [],
          },
        ]}
        selectedIds={[]}
        onToggle={noop}
      />,
    );
    expect(html).toContain('гипотеза — ниже порога 8');
  });

  it('names an honest count when it has one, without inventing a number', () => {
    const html = renderToStaticMarkup(
      <OnboardingRolesStep
        cards={[
          { id: 'role-0', title: 'VP of Technology Operations', vacancyCount: 34, evidenceTags: [] },
        ]}
        selectedIds={[]}
        onToggle={noop}
      />,
    );
    expect(html).toContain('34 вакансии');
  });

  it('says plainly that the count is not ready yet, rather than showing a fake one', () => {
    const html = renderToStaticMarkup(
      <OnboardingRolesStep
        cards={[{ id: 'role-0', title: 'VP of Technology Operations', evidenceTags: [] }]}
        selectedIds={[]}
        onToggle={noop}
      />,
    );
    expect(html).toContain('Число вакансий уточняется');
  });

  it('has an honest empty state when no role could be built from the profile', () => {
    const html = renderToStaticMarkup(<OnboardingRolesStep cards={[]} selectedIds={[]} onToggle={noop} />);
    expect(html).toContain('Пока не удалось предложить роль');
  });
});
