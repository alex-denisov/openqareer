import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CandidateFootprintAuditSurfaceProps } from './CandidateFootprintAuditSurface';
import { CandidateFootprintAuditSurface } from './CandidateFootprintAuditSurface';

function baseProps(
  overrides: Partial<CandidateFootprintAuditSurfaceProps> = {},
): CandidateFootprintAuditSurfaceProps {
  return {
    plan: [
      {
        id: '0123456789abcdef0123',
        adapterId: 'sherlock',
        kind: 'username',
        preview: 'Проверить открытые профили под ником «ada»',
        selectedByDefault: true,
        available: true,
      },
      {
        id: '1234567890abcdef1234',
        adapterId: 'hibp',
        kind: 'email',
        preview: 'Проверить почту a***@example.test',
        selectedByDefault: false,
        available: false,
      },
    ],
    sourceAvailability: {
      sherlock: true,
      maigret: true,
      hibp: false,
      wayback: true,
      exa: false,
    },
    consent: { approved: false, granted: false, versionId: 'digital_footprint-v1.1' },
    audit: null,
    selectedQueryIds: new Set(['0123456789abcdef0123']),
    onRetry: vi.fn(),
    onToggleQuery: vi.fn(),
    onConfirmOwnership: vi.fn(),
    onGrantConsent: vi.fn(),
    onRevokeConsent: vi.fn(),
    onStart: vi.fn(),
    onReview: vi.fn(),
    onRequestDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    ...overrides,
  };
}

describe('CandidateFootprintAuditSurface', () => {
  it('shows the exact disabled consent gate and labels sources without implying a scan', () => {
    const html = renderToStaticMarkup(<CandidateFootprintAuditSurface {...baseProps()} />);

    expect(html).toContain('<h2>Как вас видят</h2>');
    expect(html).toContain('Скоро: ждёт утверждения текста согласия');
    expect(html).toContain('источник не подключён');
    expect(html).toContain('не запускалось');
    expect(html).not.toContain('Безопасно');
    expect(html).not.toContain('100 / 100');
  });

  it('shows source, observation time and candidate review actions for a completed finding', () => {
    const audit: NonNullable<CandidateFootprintAuditSurfaceProps['audit']> = {
      id: 'audit-1',
      candidateId: 'candidate-1',
      state: 'completed',
      selectedQueryIds: ['0123456789abcdef0123'],
      adapterStatuses: [
        {
          adapterId: 'sherlock',
          state: 'checked',
          sourcesChecked: 1,
          findingsCount: 1,
          checkedAt: '2026-10-04T12:00:00.000Z',
        },
      ],
      findings: [{
        id: 'finding-1',
        adapter: 'sherlock',
        kind: 'profile',
        url: 'https://github.com/ada',
        title: 'GitHub',
        detail: 'Открытая страница найдена по нику; владение нужно подтвердить.',
        match: 'likely_self',
        observedAt: '2026-10-04T12:00:00.000Z',
        receipt: { method: 'GET', source: 'GitHub', query: 'username=ada' },
        receipts: [{ method: 'GET', source: 'GitHub', query: 'username=ada' }],
        sources: ['sherlock'],
        automatedMatch: 'likely_self',
        review: 'unreviewed',
      }],
      ownershipConfirmedAt: '2026-10-04T11:59:00.000Z',
      startedAt: '2026-10-04T12:00:00.000Z',
      completedAt: '2026-10-04T12:00:02.000Z',
    };
    const html = renderToStaticMarkup(
      <CandidateFootprintAuditSurface
        {...baseProps({
          audit,
          consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
          ownershipConfirmed: true,
        })}
      />,
    );

    expect(html).toContain('GitHub');
    expect(html).toContain('4 окт. 2026 г.');
    expect(html).toContain('Источники: sherlock');
    expect(html).toContain('Отозвать согласие');
    expect(html).toContain('Это я');
    expect(html).toContain('Не я');
    expect(html).toContain('Скрыть');
  });

  it('keeps sources without keys marked not connected after an audit skips them', () => {
    const html = renderToStaticMarkup(
      <CandidateFootprintAuditSurface
        {...baseProps({
          audit: {
            id: 'audit-skipped-sources',
            candidateId: 'candidate-1',
            state: 'completed',
            selectedQueryIds: ['0123456789abcdef0123'],
            adapterStatuses: [
              { adapterId: 'sherlock', state: 'checked', sourcesChecked: 1, findingsCount: 0 },
              { adapterId: 'maigret', state: 'not_run', sourcesChecked: 0, findingsCount: 0 },
              { adapterId: 'hibp', state: 'not_run', sourcesChecked: 0, findingsCount: 0 },
              { adapterId: 'wayback', state: 'not_run', sourcesChecked: 0, findingsCount: 0 },
              { adapterId: 'exa', state: 'not_run', sourcesChecked: 0, findingsCount: 0 },
            ],
            findings: [],
            ownershipConfirmedAt: '2026-10-04T11:59:00.000Z',
            startedAt: '2026-10-04T12:00:00.000Z',
            completedAt: '2026-10-04T12:00:02.000Z',
          },
        })}
      />,
    );

    expect(html.match(/источник не подключён/gu)).toHaveLength(2);
  });

  it('discloses that the profile photo URL is matched locally and never sent for image search', () => {
    const html = renderToStaticMarkup(
      <CandidateFootprintAuditSurface
        {...baseProps({
          consent: { approved: true, granted: false, versionId: 'digital_footprint-v1.1' },
        })}
      />,
    );

    expect(html).toContain('Ссылка на фото из профиля не передаётся поисковику');
    expect(html).toContain('Обратный поиск по изображению не выполняется.');
  });

  it('shows hidden findings in a disclosure with a real restore action', () => {
    const props = baseProps({
      audit: {
        id: 'audit-1',
        candidateId: 'candidate-1',
        state: 'completed',
        selectedQueryIds: [],
        adapterStatuses: [],
        findings: [{
          id: 'finding-hidden',
          adapter: 'wayback',
          kind: 'archive',
          url: 'https://web.archive.org/web/20240101000000/https://portfolio.example',
          title: 'Архивная копия профиля',
          detail: 'В архиве найден снимок.',
          match: 'likely_self',
          observedAt: '2026-10-04T12:00:00.000Z',
          receipt: { method: 'GET', source: 'Internet Archive CDX', query: 'url=https://portfolio.example' },
          receipts: [{ method: 'GET', source: 'Internet Archive CDX', query: 'url=https://portfolio.example' }],
          sources: ['wayback'],
          automatedMatch: 'likely_self',
          review: 'hidden',
        }],
        ownershipConfirmedAt: '2026-10-04T11:59:00.000Z',
        startedAt: '2026-10-04T12:00:00.000Z',
        completedAt: '2026-10-04T12:00:02.000Z',
      },
    });

    const html = renderToStaticMarkup(<CandidateFootprintAuditSurface {...props} />);
    expect(html).toContain('Скрытые находки (1)');
    expect(html).toContain('Показать');
  });
});
