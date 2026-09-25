import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileCoursesSection } from './ProfileCoursesSection';
import type { ResumeDraft } from './resumeTypes';

const draft: ResumeDraft = {
  candidate: { fullName: 'Jordan Rivers' },
  experience: [],
  skills: [],
  education: [],
  languages: [],
  courses: [],
};

describe('ProfileCoursesSection empty state (B266)', () => {
  it('does not claim the source section is empty after an import', () => {
    const html = renderToStaticMarkup(
      <ProfileCoursesSection draft={draft} onSectionSave={() => {}} importedLabel="LinkedIn" />,
    );
    expect(html).not.toContain('не ошибка импорта');
    expect(html).not.toContain('не передал');
    expect(html).toContain('Импорт из LinkedIn курсов не нашёл');
    expect(html).toContain('добавьте их вручную');
  });
});
