import { describe, expect, it } from 'vitest';
import type { ApprovedVacancyLetterResult } from './vacancyLetterApi';
import { resumeRowNote } from './vacancyLetterResumeNote';

const approved = (resume: ApprovedVacancyLetterResult['resume']): ApprovedVacancyLetterResult => ({
  applicationId: 'app-1',
  documentId: 'doc-1',
  approvedAt: '2026-11-06T10:00:00.000Z',
  status: 'approved',
  sent: false,
  resume,
});

describe('resumeRowNote (B601)', () => {
  it('после одобрения со снимком называет дату снимка по макету', () => {
    const note = resumeRowNote({
      resumeAvailable: true,
      approved: approved({ versionId: 'v', documentId: 'd', snapshotAt: '2026-10-02T12:00:00.000Z' }),
    });
    expect(note).toBe('Снимок от 02.10, мастер-резюме не менялось');
  });

  it('после одобрения без резюме не обещает приложение', () => {
    expect(resumeRowNote({ resumeAvailable: false, approved: approved(null) })).toBe(
      'Резюме не прикреплено: в профиле нет резюме',
    );
  });

  it('до одобрения: резюме есть — прикрепится при одобрении', () => {
    expect(resumeRowNote({ resumeAvailable: true })).toBe('Снимок резюме прикрепится при одобрении письма');
  });

  it('до одобрения: резюме нет — говорит, что прикрепить нечего', () => {
    expect(resumeRowNote({ resumeAvailable: false })).toMatch(/^В профиле нет резюме/u);
  });

  it('состояние неизвестно — без пояснения, прежней зашитой строки нет', () => {
    expect(resumeRowNote({})).toBeUndefined();
  });
});
