// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import { ProfileEducationSection } from './ProfileEducationSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('education description without LinkedIn «more» (01.11)', () => {
  it('drops the «.... more» tail an import kept', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const draft = {
      ...EMPTY_RESUME_DRAFT,
      education: [
        {
          id: 'edu-1',
          evidenceMemoryId: 'm-1',
          institution: 'МГУ',
          description: 'Graduated with honors.... more',
        },
      ],
    };
    act(() => root.render(<ProfileEducationSection draft={draft} onSectionSave={() => true} />));
    expect(host.textContent).toContain('Graduated with honors.');
    expect(host.textContent).not.toMatch(/more|\.{2,}/u);
    act(() => root.unmount());
  });
});
