import { describe, expect, it, vi } from 'vitest';
import { openExpertPanel, type ExpertPanelConfig } from './CareerWorkspaceShellHelpers';

describe('openExpertPanel contextOnly (макет 13, 28.10)', () => {
  it('switches the consultant to the selected company without opening the panel', () => {
    let config: ExpertPanelConfig = {
      open: false,
      stage: 'vacancies',
      subject: { kind: 'vacancy', id: 'lone-wolf' },
      subjectTitle: 'О вакансии: VP of Engineering — Lone Wolf',
    };
    const setConfig = vi.fn((update) => {
      config = typeof update === 'function' ? update(config) : update;
    });
    const setExpanded = vi.fn();
    const setAccountOpen = vi.fn();
    openExpertPanel(
      setConfig,
      setExpanded,
      setAccountOpen,
      'opportunities',
      false,
      'vacancies',
      { kind: 'company', id: 'autodesk' },
      'Autodesk',
      undefined,
      { contextOnly: true },
    );
    expect(config).toMatchObject({
      open: false,
      stage: 'vacancies',
      subject: { kind: 'company', id: 'autodesk' },
      subjectTitle: 'Autodesk',
    });
    expect(setExpanded).not.toHaveBeenCalled();
    expect(setAccountOpen).not.toHaveBeenCalled();
  });
});

describe('openExpertPanel focusInput (Д4)', () => {
  function run(config: ExpertPanelConfig, options?: { focusInput?: boolean }) {
    let next = config;
    openExpertPanel(
      (update) => {
        next = typeof update === 'function' ? update(next) : update;
      },
      vi.fn(),
      vi.fn(),
      'opportunities',
      false,
      'vacancies',
      { kind: 'vacancy', id: 'v1' },
      'Правки письма',
      undefined,
      options,
    );
    return next;
  }

  it('gives a new request each time, so a second tap on an open panel still focuses', () => {
    const closed: ExpertPanelConfig = { open: false, stage: 'vacancies' };
    const first = run(closed, { focusInput: true });
    const second = run(first, { focusInput: true });
    expect(first.focusRequest).toBeGreaterThan(0);
    expect(second.focusRequest).toBeGreaterThan(first.focusRequest ?? 0);
  });

  it('asks for no focus unless the opener wants it', () => {
    expect(run({ open: false, stage: 'vacancies' }).focusRequest).toBeUndefined();
  });
});
