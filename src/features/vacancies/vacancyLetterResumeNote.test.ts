import { describe, expect, it } from 'vitest';
import type { ApprovedVacancyLetterResult } from './vacancyLetterApi';
import { resumeRowView } from './vacancyLetterResumeNote';

const approved = (resume: ApprovedVacancyLetterResult['resume']): ApprovedVacancyLetterResult => ({
  applicationId: 'app-1',
  documentId: 'doc-1',
  approvedAt: '2026-11-06T10:00:00.000Z',
  status: 'approved',
  sent: false,
  resume,
});
const SNAPSHOT_AT = '2026-10-02T12:00:00.000Z';

describe('resumeRowView (B601, решения владельца 08.11)', () => {
  it('1. до одобрения, Basic и выше: резюме под вакансию прикрепится', () => {
    expect(resumeRowView({ resumeAvailable: true, resumeKind: 'targeted' })).toEqual({
      title: 'Резюме под вакансию',
      note: 'Резюме под вакансию прикрепится при одобрении письма',
    });
  });

  it('2. до одобрения, Free: общее резюме прикрепится, заголовок «Резюме»', () => {
    expect(resumeRowView({ resumeAvailable: true, resumeKind: 'master' })).toEqual({
      title: 'Резюме',
      note: 'Общее резюме прикрепится при одобрении письма',
    });
  });

  it('3. после одобрения: снимок по макету, для Free — общее резюме', () => {
    const targeted = approved({
      kind: 'targeted',
      versionId: 'v',
      documentId: 'd',
      snapshotAt: SNAPSHOT_AT,
    });
    expect(
      resumeRowView({ resumeAvailable: true, resumeKind: 'targeted', approved: targeted }).note,
    ).toBe('Снимок от 02.10, мастер-резюме не менялось');
    const master = approved({
      kind: 'master',
      versionId: null,
      documentId: 'd',
      snapshotAt: SNAPSHOT_AT,
    });
    expect(
      resumeRowView({ resumeAvailable: true, resumeKind: 'master', approved: master }),
    ).toEqual({
      title: 'Резюме',
      note: 'Общее резюме, снимок от 02.10',
    });
  });

  it('4. опыта нет: до и после одобрения письмо резюме не обещает', () => {
    const text = 'В профиле нет опыта работы: отклик уйдёт без резюме, письмо об этом не упоминает';
    expect(resumeRowView({ resumeAvailable: false, resumeKind: 'targeted' }).note).toBe(text);
    expect(resumeRowView({ resumeAvailable: false, approved: approved(null) }).note).toBe(text);
  });

  it('5. снимок не создался: гейт с кнопкой «Подготовить резюме»', () => {
    expect(
      resumeRowView({
        resumeAvailable: true,
        resumeKind: 'targeted',
        failure: { retried: false, generalResume: null },
      }),
    ).toEqual({
      title: 'Резюме под вакансию',
      note: 'Не удалось подготовить резюме. Подготовьте его, чтобы одобрить письмо',
      action: 'prepare',
    });
  });

  it('5. повтор не удался и есть общее резюме: предлагает приложить его', () => {
    const view = resumeRowView({
      resumeAvailable: true,
      resumeKind: 'targeted',
      failure: { retried: true, generalResume: { documentId: 'g', fileName: 'cv.pdf' } },
    });
    expect(view.action).toBe('attach-general');
    expect(view.note).toContain('«cv.pdf»');
  });

  it('повтор не удался, общего резюме нет: снова «Подготовить резюме»', () => {
    expect(
      resumeRowView({ resumeAvailable: true, failure: { retried: true, generalResume: null } })
        .action,
    ).toBe('prepare');
  });

  it('состояние неизвестно: без пояснения, без прежней зашитой строки', () => {
    expect(resumeRowView({})).toEqual({ title: 'Резюме под вакансию' });
  });
});
