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
