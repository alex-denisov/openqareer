// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CandidateFootprintAuditSurfaceProps } from './CandidateFootprintAuditSurface';
import { CandidateFootprintAuditSurface, SourceCapability } from './CandidateFootprintAuditSurface';

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

async function renderAtStep(
  props: CandidateFootprintAuditSurfaceProps,
  stepLabel: string,
): Promise<string> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<CandidateFootprintAuditSurface {...props} />);
  });
  try {
    const step = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(stepLabel),
    );
    if (!step || step.disabled) throw new Error(`Step is unavailable: ${stepLabel}`);
    await act(async () => {
      step.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return container.innerHTML;
  } finally {
    act(() => root.unmount());
  }
}

describe('CandidateFootprintAuditSurface', () => {
  it('shows the exact disabled consent gate and labels sources without implying a scan', () => {
    const html = renderToStaticMarkup(<CandidateFootprintAuditSurface {...baseProps()} />);

    expect(html).toContain('role="region" aria-label="Цифровой след"');
    expect(html).toContain('aria-label="Шаги цифрового следа"');
    expect(html).not.toContain('<h2>Как вас видят</h2>');
    expect(html).toContain('Текст согласия ждёт утверждения');
    expect(html).toContain('<strong>2 Сканирование</strong><span>Не запускалась</span>');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Запустить выбранные проверки');
    expect(html).not.toContain('Безопасно');
    expect(html).not.toContain('100 / 100');
  });

  it('shows source, observation time and candidate review actions for a completed finding', async () => {
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
      findings: [
        {
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
        },
      ],
      ownershipConfirmedAt: '2026-10-04T11:59:00.000Z',
      startedAt: '2026-10-04T12:00:00.000Z',
      completedAt: '2026-10-04T12:00:02.000Z',
    };
    const completedProps = baseProps({
      audit,
      consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
      ownershipConfirmed: true,
    });
    const html = renderToStaticMarkup(<CandidateFootprintAuditSurface {...completedProps} />);

    // Mockup 2: what was found, when the scan found it, and the source one click away.
    expect(html).toContain('GitHub');
    expect(html).toContain('Найдено сканированием 04.10.');
    expect(html).toContain('href="https://github.com/ada"');
    const consentHtml = await renderAtStep(completedProps, '1 Согласие');
    expect(consentHtml).toContain('Отозвать согласие');
    expect(html).toContain('Это я');
    expect(html).toContain('Не я');
    expect(html).not.toContain('Скрыть');
  });

  it('keeps sources without keys marked not connected after an audit skips them', async () => {
    const html = await renderAtStep(
      baseProps({
        consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
        ownershipConfirmed: true,
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
      }),
      '2 Сканирование',
    );

    expect(html.match(/подготовлено, не подключено/gu)).toHaveLength(3);
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

  it('keeps a finding hidden earlier in the list with its review actions', () => {
    const props = baseProps({
      audit: {
        id: 'audit-1',
        candidateId: 'candidate-1',
        state: 'completed',
        selectedQueryIds: [],
        adapterStatuses: [],
        findings: [
          {
            id: 'finding-hidden',
            adapter: 'wayback',
            kind: 'archive',
            url: 'https://web.archive.org/web/20240101000000/https://portfolio.example',
            title: 'Архивная копия профиля',
            detail: 'В архиве найден снимок.',
            match: 'likely_self',
            observedAt: '2026-10-04T12:00:00.000Z',
            receipt: {
              method: 'GET',
              source: 'Internet Archive CDX',
              query: 'url=https://portfolio.example',
            },
            receipts: [
              {
                method: 'GET',
                source: 'Internet Archive CDX',
                query: 'url=https://portfolio.example',
              },
            ],
            sources: ['wayback'],
            automatedMatch: 'likely_self',
            review: 'hidden',
          },
        ],
        ownershipConfirmedAt: '2026-10-04T11:59:00.000Z',
        startedAt: '2026-10-04T12:00:00.000Z',
        completedAt: '2026-10-04T12:00:02.000Z',
      },
    });

    const html = renderToStaticMarkup(<CandidateFootprintAuditSurface {...props} />);
    // The approved mockup has no hiding: every finding is answered with «Это я» or «Не я».
    expect(html).toContain('Архивная копия профиля');
    expect(html).toContain('Это я');
    expect(html).not.toContain('Скрытые находки');
  });

  it('B375: отображает адаптеры метаданных и секретов (B368) со статусом в состоянии источников', async () => {
    const html = await renderAtStep(
      baseProps({
        consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
        ownershipConfirmed: true,
      }),
      '2 Сканирование',
    );
    expect(html).toContain('Метаданные файлов');
    expect(html).toContain('Секреты в коде');
    expect(html).toContain('подготовлено');
  });

  it('B375: SourceCapability корректно отображает статусы available, prepared, future', () => {
    const availHtml = renderToStaticMarkup(
      <SourceCapability title="Доступный источник" status="available" />,
    );
    expect(availHtml).toContain('is-available');
    expect(availHtml).toContain('доступно');

    const prepHtml = renderToStaticMarkup(
      <SourceCapability title="Подготовленный источник" status="prepared" />,
    );
    expect(prepHtml).toContain('is-prepared');
    expect(prepHtml).toContain('подготовлено');

    const futureHtml = renderToStaticMarkup(
      <SourceCapability title="Планируемый источник" status="future" />,
    );
    expect(futureHtml).toContain('is-future');
    expect(futureHtml).toContain('в планах');
  });

  it('B375: отображает блок «Не удалось определить компанию» с кнопкой «Ввести вручную» при наличии неопределённых работодателей', async () => {
    const props = baseProps({
      unidentifiedEmployers: [
        'Enterprise Public Cloud Platform (IaaS / PaaS)',
        'Corporate University of a Top-Tier Financial Institution',
      ],
      onAddManualEmployer: vi.fn(),
    });

    const html = await renderAtStep(
      {
        ...props,
        consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
        ownershipConfirmed: true,
      },
      '2 Сканирование',
    );
    expect(html).toContain('Не удалось определить компанию');
    expect(html).toContain('Enterprise Public Cloud Platform (IaaS / PaaS)');
    expect(html).toContain('Corporate University of a Top-Tier Financial Institution');
    expect(html).toContain('Ввести вручную');
  });
});
