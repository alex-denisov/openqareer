// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FootprintReview } from '../../../shared/candidateFootprint';
import {
  CandidateFootprintAuditSurface,
  type CandidateFootprintAuditSurfaceProps,
} from './CandidateFootprintAuditSurface';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function finding(review: FootprintReview = 'unreviewed') {
  return {
    id: 'finding-github-1',
    adapter: 'sherlock',
    kind: 'profile',
    url: 'https://github.com/ada',
    title: 'Профиль на GitHub: ada',
    detail: 'Открытая страница найдена по выбранному никнейму.',
    match: 'likely_self' as const,
    observedAt: '2026-10-04T12:00:00.000Z',
    receipt: { method: 'GET', source: 'GitHub', query: 'username=ada' },
    receipts: [{ method: 'GET', source: 'GitHub', query: 'username=ada' }],
    sources: ['sherlock'],
    automatedMatch: 'likely_self' as const,
    review,
  };
}

function completedAudit(review: FootprintReview = 'unreviewed') {
  return {
    id: 'audit-1',
    candidateId: 'candidate-1',
    state: 'completed' as const,
    selectedQueryIds: ['query-github'],
    adapterStatuses: [
      {
        adapterId: 'sherlock' as const,
        state: 'checked' as const,
        sourcesChecked: 1,
        findingsCount: 1,
        checkedAt: '2026-10-04T12:00:00.000Z',
      },
    ],
    findings: [finding(review)],
    ownershipConfirmedAt: '2026-10-04T11:59:00.000Z',
    startedAt: '2026-10-04T12:00:00.000Z',
    completedAt: '2026-10-04T12:00:02.000Z',
  } satisfies NonNullable<CandidateFootprintAuditSurfaceProps['audit']>;
}

function baseProps(
  overrides: Partial<CandidateFootprintAuditSurfaceProps> = {},
): CandidateFootprintAuditSurfaceProps {
  return {
    plan: [
      {
        id: 'query-github',
        adapterId: 'sherlock',
        kind: 'username',
        preview: 'Проверить открытые профили под выбранным никнеймом',
        selectedByDefault: true,
        available: true,
      },
      {
        id: 'query-email',
        adapterId: 'hibp',
        kind: 'email',
        preview: 'Проверить выбранную почту в открытых утечках',
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
    selectedQueryIds: new Set(['query-github']),
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

describe('CandidateFootprintAuditSurface four-step profile flow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  async function renderSurface(props: CandidateFootprintAuditSurfaceProps) {
    await act(async () => {
      root.render(<CandidateFootprintAuditSurface {...props} />);
    });
  }

  function button(label: string) {
    return Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(label),
    );
  }

  async function click(label: string) {
    const target = button(label);
    if (!target) throw new Error(`Missing button: ${label}`);
    await act(async () => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('keeps future steps unavailable before consent and an audit, with the real pending disclosure', async () => {
    const props = baseProps();
    await renderSurface(props);

    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(container.querySelectorAll('.profile-footprint-step-panel')).toHaveLength(1);
    expect(button('1 Согласие')?.getAttribute('aria-current')).toBe('step');
    expect(button('2 Сканирование')?.disabled).toBe(true);
    expect(button('3 Находки')?.disabled).toBe(true);
    expect(button('4 Чек-лист')?.disabled).toBe(true);
    expect(container.textContent).toContain('Скоро: ждёт утверждения текста согласия');
    expect(container.textContent).toContain('Ссылка на фото из профиля не передаётся поисковику');
    expect(button('Запустить выбранные проверки')).toBeUndefined();
    expect(props.onStart).not.toHaveBeenCalled();

    await click('3 Находки');
    expect(button('1 Согласие')?.getAttribute('aria-current')).toBe('step');
  });

  it('shows the real query plan, source states, and start action in the scan step after consent', async () => {
    const props = baseProps({
      consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
      ownershipConfirmed: true,
    });
    await renderSurface(props);
    await click('2 Сканирование');

    expect(button('2 Сканирование')?.getAttribute('aria-current')).toBe('step');
    expect(container.textContent).toContain('План запросов');
    expect(container.textContent).toContain('Состояние источников');
    expect(container.textContent).toContain('Проверить открытые профили под выбранным никнеймом');
    expect(container.textContent).toContain('подготовлено, не подключено');
    expect(button('Запустить выбранные проверки')?.disabled).toBe(false);

    await click('Запустить выбранные проверки');
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('routes actual review actions to their finding and derives checklist rows from review state', async () => {
    const props = baseProps({
      consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
      ownershipConfirmed: true,
      audit: completedAudit('unreviewed'),
    });
    await renderSurface(props);

    expect(button('3 Находки')?.getAttribute('aria-current')).toBe('step');
    expect(container.textContent).toContain('Профиль на GitHub: ada');
    expect(container.querySelector('[role="group"][aria-label="Отметить находку"]')).not.toBeNull();
    await click('Это я');
    expect(props.onReview).toHaveBeenCalledWith('finding-github-1', 'confirmed_self');

    await click('4 Чек-лист');
    expect(button('4 Чек-лист')?.getAttribute('aria-current')).toBe('step');
    expect(container.textContent).toContain('Чек-лист санации');
    expect(container.textContent).toContain('Находки разобраны');
    expect(container.textContent).toContain('Осталось 1');
    expect(container.textContent).not.toContain('sherlock');
    expect(button('Удалить сохранённые находки')).toBeUndefined();
    await click('Разобрать находки');
    expect(button('3 Находки')?.getAttribute('aria-current')).toBe('step');

    const reviewedProps = baseProps({
      consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
      ownershipConfirmed: true,
      audit: completedAudit('confirmed_self'),
    });
    await renderSurface(reviewedProps);
    await click('4 Чек-лист');
    expect(container.textContent).toContain('3 из 5 пунктов');
    expect(button('4 Чек-лист')?.textContent).toContain('3 из 5 пунктов');
  });

  it('marks leaks and old accounts and adds artifacts to the profile from the checklist', async () => {
    const base = completedAudit('confirmed_self');
    const audit = {
      ...base,
      findings: [
        { ...finding('confirmed_self'), id: 'leak', kind: 'breach', title: 'Почта в утечке' },
        { ...finding('confirmed_self'), id: 'old', title: 'Старый аккаунт', staleAccount: true },
        { ...finding('confirmed_self'), id: 'talk', kind: 'mention', title: 'Доклад, 2023' },
      ],
    };
    const props = baseProps({
      consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
      ownershipConfirmed: true,
      audit,
      onMarkFinding: vi.fn(),
      onAddToProfile: vi.fn(),
    });
    await renderSurface(props);
    expect(button('4 Чек-лист')?.getAttribute('aria-current')).toBe('step');
    await click('Пароль сменён');
    expect(props.onMarkFinding).toHaveBeenCalledWith('leak', 'password_changed');
    await click('Оставить');
    expect(props.onMarkFinding).toHaveBeenCalledWith('old', 'account_kept');
    await click('Добавить в профиль');
    expect(props.onAddToProfile).toHaveBeenCalledWith('talk');
    expect(container.textContent).toContain('Файлы не проверялись');
  });

  it('uses the loaded audit for the initial step and keeps a step selected during loading', async () => {
    await renderSurface(baseProps({ loading: true }));
    expect(button('1 Согласие')?.getAttribute('aria-current')).toBe('step');

    await renderSurface(
      baseProps({
        consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
        ownershipConfirmed: true,
        audit: completedAudit(),
        loading: false,
      }),
    );
    expect(button('3 Находки')?.getAttribute('aria-current')).toBe('step');
  });

  it('preserves a step selected before the first audit response resolves', async () => {
    const initial = baseProps({
      consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
      ownershipConfirmed: true,
      loading: true,
    });
    await renderSurface(initial);
    await click('1 Согласие');

    await renderSurface(
      baseProps({
        consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
        ownershipConfirmed: true,
        audit: completedAudit(),
        loading: false,
      }),
    );
    expect(button('1 Согласие')?.getAttribute('aria-current')).toBe('step');
  });

  it('opens real privacy, revoke, and deletion controls from the findings privacy line', async () => {
    const props = baseProps({
      consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
      ownershipConfirmed: true,
      audit: completedAudit(),
    });
    await renderSurface(props);

    const surface = container.querySelector('.career-footprint-surface');
    expect(surface?.getAttribute('role')).toBe('region');
    expect(surface?.getAttribute('aria-label')).toBe('Цифровой след');
    expect(button('Находки видите только вы')?.getAttribute('aria-expanded')).toBe('false');
    expect(button('Отозвать согласие')).toBeUndefined();
    expect(button('Удалить сохранённые находки')).toBeUndefined();

    await click('Находки видите только вы');
    expect(container.querySelector('dialog#profile-footprint-privacy-controls')).not.toBeNull();
    expect(button('Отозвать согласие')).toBeDefined();
    expect(button('Удалить сохранённые находки')).toBeDefined();
    expect(container.textContent).toContain('Согласие выдано. Отзыв остановит текущую проверку');

    await click('Отозвать согласие');
    expect(props.onRevokeConsent).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Отозвать согласие? Проверка остановится');
    await click('Отозвать согласие');
    expect(props.onRevokeConsent).toHaveBeenCalledTimes(1);
    await click('Удалить сохранённые находки');
    expect(props.onRequestDelete).toHaveBeenCalledTimes(1);
  });
});
