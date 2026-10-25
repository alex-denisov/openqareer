// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  emptyRelocationQuestionnaire,
  type RelocationQuestionnaire,
} from '../../../../shared/relocationQuestionnaire';
import { EducationForm } from './EducationForm';

describe('EducationForm (mockup 15 view=i2)', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('shows a saved diploma as a row and opens its fields only on «Изменить»', async () => {
    render(withDiploma());

    const row = host?.querySelector('.career-relocation-doc-list li');
    expect(row?.textContent).toContain('МГТУ им. Баумана');
    expect(row?.textContent).toContain('Информатика, Магистратура, 2008 — 2013, Россия');
    expect(host?.querySelector('#relocation-education-e1-title')).toBeNull();
    expect(host?.textContent).toContain('Признание диплома за рубежом не указано');

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[aria-label="Изменить: МГТУ им. Баумана"]')?.click();
    });
    expect(host?.querySelector('#relocation-education-e1-title')).not.toBeNull();
  });

  function withDiploma(): RelocationQuestionnaire {
    const profile = emptyRelocationQuestionnaire();
    return {
      ...profile,
      education: {
        ...profile.education,
        education: [
          {
            id: 'e1',
            title: 'МГТУ им. Баумана',
            level: 'master',
            fieldOfStudy: 'Информатика',
            countryCode: 'RU',
            recognitionStatus: 'unknown',
            startedAt: '2008-09-01',
            completedAt: '2013-06-30',
          },
        ],
      },
    };
  }

  function render(profile: RelocationQuestionnaire) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <EducationForm
          step="education"
          profile={profile}
          onProfileChange={() => undefined}
          onImportLinkedIn={() => undefined}
          importBusy={false}
        />,
      ),
    );
  }
});
