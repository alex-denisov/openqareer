import { describe, expect, it } from 'vitest';
import {
  createApplicationRecord,
  updateApplicationStatus,
  calculateFunnelMetrics,
  type CandidateApplication,
} from '../applicationCrm';

describe('applicationCrm', () => {
  it('creates an application record with initial status sent', () => {
    const app = createApplicationRecord({
      id: 'app-1',
      vacancyId: 'hh-vac-1',
      vacancyTitle: 'Lead Software Engineer',
      company: 'Yandex',
      platform: 'hh',
      sourceUrl: 'https://hh.ru/vacancy/1',
      resumeId: 'res-1',
    });

    expect(app.id).toBe('app-1');
    expect(app.status).toBe('sent');
    expect(app.history).toHaveLength(1);
    expect(app.history[0].status).toBe('sent');
  });

  it('updates application status with audit trail history', () => {
    const app = createApplicationRecord({
      id: 'app-1',
      vacancyId: 'hh-vac-1',
      vacancyTitle: 'Lead Software Engineer',
      company: 'Yandex',
      platform: 'hh',
      sourceUrl: 'https://hh.ru/vacancy/1',
    });

    const viewed = updateApplicationStatus(app, 'viewed', 'Рекрутер просмотрел резюме');
    expect(viewed.status).toBe('viewed');
    expect(viewed.history).toHaveLength(2);

    const invited = updateApplicationStatus(viewed, 'invited', 'Приглашение на техническое интервью');
    expect(invited.status).toBe('invited');
    expect(invited.history).toHaveLength(3);
  });

  it('calculates conversion funnel metrics correctly', () => {
    const applications: CandidateApplication[] = [
      {
        id: '1',
        vacancyId: 'v1',
        vacancyTitle: 'Role 1',
        company: 'Comp 1',
        platform: 'hh',
        status: 'sent',
        createdAt: '2026-08-19T00:00:00Z',
        updatedAt: '2026-08-19T00:00:00Z',
        history: [{ status: 'sent', timestamp: '2026-08-19T00:00:00Z' }],
      },
      {
        id: '2',
        vacancyId: 'v2',
        vacancyTitle: 'Role 2',
        company: 'Comp 2',
        platform: 'hh',
        status: 'viewed',
        createdAt: '2026-08-19T00:00:00Z',
        updatedAt: '2026-08-19T00:00:00Z',
        history: [{ status: 'sent', timestamp: '2026-08-19T00:00:00Z' }, { status: 'viewed', timestamp: '2026-08-19T01:00:00Z' }],
      },
      {
        id: '3',
        vacancyId: 'v3',
        vacancyTitle: 'Role 3',
        company: 'Comp 3',
        platform: 'hh',
        status: 'invited',
        createdAt: '2026-08-19T00:00:00Z',
        updatedAt: '2026-08-19T00:00:00Z',
        history: [{ status: 'sent', timestamp: '2026-08-19T00:00:00Z' }, { status: 'viewed', timestamp: '2026-08-19T01:00:00Z' }, { status: 'invited', timestamp: '2026-08-19T02:00:00Z' }],
      },
      {
        id: '4',
        vacancyId: 'v4',
        vacancyTitle: 'Role 4',
        company: 'Comp 4',
        platform: 'hh',
        status: 'rejected',
        createdAt: '2026-08-19T00:00:00Z',
        updatedAt: '2026-08-19T00:00:00Z',
        history: [{ status: 'sent', timestamp: '2026-08-19T00:00:00Z' }, { status: 'rejected', timestamp: '2026-08-19T01:00:00Z' }],
      },
    ];

    const metrics = calculateFunnelMetrics(applications);
    expect(metrics.totalSent).toBe(4);
    expect(metrics.viewedCount).toBe(2); // id 2 and id 3
    expect(metrics.invitedCount).toBe(1);
    expect(metrics.rejectedCount).toBe(1);
    expect(metrics.viewRate).toBe(50); // 2/4 = 50%
    expect(metrics.interviewRate).toBe(25); // 1/4 = 25%
  });
});
