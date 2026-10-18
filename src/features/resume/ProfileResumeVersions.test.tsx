// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import type {
  ResumeVersionSummary,
  StoredResumeVersion,
} from '../../../server/domain/resumeVersions';
import {
  getResumeAtsAssessment,
  getResumeVersion,
  getResumeVersions,
  updateResumeVersion,
} from './resumeVersionsApi';
import {
  ActiveVersionPanel,
  formatTargetedVersionTitle,
  useProfileResumeVersionsState,
} from './ProfileResumeVersions';
import { ProfileMobileVersions } from './ProfileMobileVersions';

vi.mock('./ResumeAtsView', () => ({
  ResumeAtsView: ({
    initialTarget,
    onTargetDirtyChange,
    onSaveTarget,
  }: {
    readonly initialTarget?: { readonly title: string; readonly requirements: readonly string[] };
    readonly onTargetDirtyChange?: (dirty: boolean) => void;
    readonly onSaveTarget?: (input: {
      readonly title: string;
      readonly requirements: readonly string[];
    }) => void;
  }) => (
    <form>
      <input
        aria-label="Reviewed target title"
        defaultValue={initialTarget?.title ?? ''}
        onChange={(event) =>
          onTargetDirtyChange?.(event.currentTarget.value !== initialTarget?.title)
        }
      />
      <button
        type="button"
        onClick={(event) => {
          const title = event.currentTarget.form?.querySelector('input')?.value ?? '';
          onSaveTarget?.({
            title,
            requirements: initialTarget?.requirements ?? [],
          });
        }}
      >
        Сохранить изменения
      </button>
    </form>
  ),
}));
vi.mock('./ProfileAtsAssessment', () => ({ ProfileAtsAssessment: () => null }));
vi.mock('./resumeVersionsApi', () => ({
  createResumeVersion: vi.fn(),
  getResumeAtsAssessment: vi.fn(),
  getResumeVersion: vi.fn(),
  getResumeVersions: vi.fn(),
  updateResumeVersion: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const versionId = 'version-review-1';
const masterRevision = 'master-revision-current';
const createdAt = '2026-10-17T10:00:00.000Z';
const snapshot = {} as StoredResumeVersion['snapshot'];

function createVersion(
  status: StoredResumeVersion['status'],
  revision: number,
): StoredResumeVersion {
  return {
    id: versionId,
    title: 'Platform Engineer',
    requirements: ['React'],
    status,
    snapshot,
    revision,
    sourceMasterRevision: masterRevision,
    createdAt,
    updatedAt: createdAt,
  };
}

const draftVersion = createVersion('draft', 1);
const approvedVersion = createVersion('approved', 2);

function summary(version: StoredResumeVersion): ResumeVersionSummary {
  return {
    id: version.id,
    title: version.title,
    requirements: version.requirements,
    status: version.status,
    revision: version.revision,
    sourceMasterRevision: version.sourceMasterRevision,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

function ApprovalHarness() {
  const state = useProfileResumeVersionsState(EMPTY_RESUME_DRAFT, []);
  const version = state.active.version;
  return (
    <div>
      <button type="button" onClick={() => void state.active.open(versionId)}>
        Open saved version
      </button>
      {version ? (
        <ActiveVersionPanel
          version={version}
          document={state.document}
          draft={EMPTY_RESUME_DRAFT}
          error={state.update.error ?? state.active.error}
          saving={state.update.saving}
          assessment={state.assessment.assessment}
          assessmentLoading={state.assessment.loading}
          assessmentError={state.assessment.error}
          onClose={state.active.close}
          onSave={state.update.save}
          approving={state.update.approving}
          onApprove={state.update.approve}
        />
      ) : null}
    </div>
  );
}

const mountedRoots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = [];

function renderApprovalHarness() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ApprovalHarness />));
  mountedRoots.push({ root, container });
  return container;
}

async function clickButton(container: HTMLElement, name: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === name,
  );
  expect(button, `expected button named ${name}`).toBeDefined();
  await act(async () => {
    button?.click();
  });
}

async function renderMobileApprovalHarness() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = {
    candidateId: 'candidate-mobile-test',
    draft: EMPTY_RESUME_DRAFT,
    memory: [],
    onRetry: () => undefined,
    onDraftChange: () => undefined,
    onSectionSave: () => true,
  };
  await act(async () => {
    root.render(<ProfileMobileVersions {...props} />);
    await Promise.resolve();
  });
  mountedRoots.push({ root, container });
  return container;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function clickButtonContaining(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text),
  );
  expect(button, `expected button containing ${text}`).toBeDefined();
  await act(async () => {
    button?.click();
  });
}

describe('resume version approval UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getResumeVersions).mockResolvedValue({
      items: [summary(draftVersion)],
      nextCursor: null,
      totalCount: 1,
      currentMasterRevision: masterRevision,
    });
    vi.mocked(getResumeVersion).mockResolvedValue({
      version: draftVersion,
      currentMasterRevision: masterRevision,
    });
    vi.mocked(getResumeAtsAssessment).mockResolvedValue(null as never);
  });

  afterEach(() => {
    for (const { root, container } of mountedRoots.splice(0)) {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('formats only titles with the exact saved prefix and preserves all other text', () => {
    const storedTitle = 'Под вакансию «Вектор Банк»';
    const arbitraryTitle = 'Под вакансию «Вектор Банк» для платформенной команды';

    expect(formatTargetedVersionTitle(storedTitle)).toBe(storedTitle);
    expect(formatTargetedVersionTitle('Platform Engineer')).toBe(
      'Под вакансию «Platform Engineer»',
    );
    expect(formatTargetedVersionTitle(arbitraryTitle)).toBe(`Под вакансию «${arbitraryTitle}»`);
  });

  it('renders a saved prefix once in the mobile version list', async () => {
    const prefixedVersion: StoredResumeVersion = {
      ...draftVersion,
      title: 'Под вакансию «Platform Engineer»',
    };
    vi.mocked(getResumeVersions).mockResolvedValue({
      items: [summary(prefixedVersion)],
      nextCursor: null,
      totalCount: 1,
      currentMasterRevision: masterRevision,
    });

    const container = await renderMobileApprovalHarness();

    expect(container.textContent).toContain('Под вакансию «Platform Engineer»');
    expect(container.textContent).not.toContain('Под вакансию «Под вакансию');
  });

  it('submits the explicit approval action and shows the server-approved status', async () => {
    vi.mocked(updateResumeVersion).mockResolvedValue({
      version: approvedVersion,
      currentMasterRevision: masterRevision,
    });
    const container = renderApprovalHarness();

    await clickButton(container, 'Open saved version');
    await clickButton(container, 'Подтвердить версию');

    expect(updateResumeVersion).toHaveBeenCalledWith(versionId, {
      title: draftVersion.title,
      requirements: draftVersion.requirements,
      expectedRevision: draftVersion.revision,
      expectedMasterRevision: masterRevision,
      status: 'approved',
    });
    expect(container.textContent).toContain('Одобрено');
    expect(container.textContent).not.toContain('Подтвердить версию');
  });

  it('keeps the draft open with an alert and allows retry after approval fails', async () => {
    vi.mocked(updateResumeVersion)
      .mockRejectedValueOnce(new Error('Конфликт версии'))
      .mockResolvedValueOnce({
        version: approvedVersion,
        currentMasterRevision: masterRevision,
      });
    const container = renderApprovalHarness();

    await clickButton(container, 'Open saved version');
    await clickButton(container, 'Подтвердить версию');

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Конфликт версии');
    expect(container.textContent).toContain('Черновик');
    expect(container.textContent).toContain('Подтвердить версию');

    await clickButton(container, 'Подтвердить версию');

    expect(updateResumeVersion).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Одобрено');
  });

  it('labels legacy sent records without claiming they were sent and keeps them read-only', async () => {
    const sentVersion = createVersion('sent', 3);
    vi.mocked(getResumeVersion).mockResolvedValue({
      version: sentVersion,
      currentMasterRevision: masterRevision,
    });
    vi.mocked(getResumeVersions).mockResolvedValue({
      items: [summary(sentVersion)],
      nextCursor: null,
      totalCount: 1,
      currentMasterRevision: masterRevision,
    });
    const container = renderApprovalHarness();

    await clickButton(container, 'Open saved version');

    expect(container.textContent).toContain('Статус отправки не подтверждён');
    expect(container.textContent).not.toContain('Отправлено');
    expect(container.textContent).not.toContain('Подтвердить версию');
  });

  it('forwards the same real approval action through the mobile versions panel', async () => {
    vi.mocked(updateResumeVersion).mockResolvedValue({
      version: approvedVersion,
      currentMasterRevision: masterRevision,
    });
    const container = await renderMobileApprovalHarness();

    await clickButtonContaining(container, 'Под вакансию «Platform Engineer»');
    await clickButton(container, 'Подтвердить версию');

    expect(updateResumeVersion).toHaveBeenCalledWith(versionId, {
      title: draftVersion.title,
      requirements: draftVersion.requirements,
      expectedRevision: draftVersion.revision,
      expectedMasterRevision: masterRevision,
      status: 'approved',
    });
    expect(container.textContent).toContain('Одобрено');
  });

  it('blocks approval when title edits differ from the saved snapshot and allows approval after reverting', async () => {
    const container = renderApprovalHarness();

    await clickButton(container, 'Open saved version');
    const titleInput = container.querySelector(
      '[aria-label="Reviewed target title"]',
    ) as HTMLInputElement;
    await setInputValue(titleInput, 'Unsaved title');

    const approve = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Подтвердить версию',
    );
    expect(approve?.disabled).toBe(true);
    expect(container.textContent).toContain('Сохраните изменения перед подтверждением версии.');
    expect(updateResumeVersion).not.toHaveBeenCalled();

    await setInputValue(titleInput, draftVersion.title);
    expect(approve?.disabled).toBe(false);
  });

  it('saves edited fields as a new draft revision before approving that saved snapshot', async () => {
    const editedVersion: StoredResumeVersion = {
      ...draftVersion,
      title: 'Platform Engineer II',
      revision: 2,
    };
    const approvedEditedVersion: StoredResumeVersion = {
      ...editedVersion,
      status: 'approved',
      revision: 3,
    };
    vi.mocked(updateResumeVersion)
      .mockResolvedValueOnce({
        version: editedVersion,
        currentMasterRevision: masterRevision,
      })
      .mockResolvedValueOnce({
        version: approvedEditedVersion,
        currentMasterRevision: masterRevision,
      });
    const container = renderApprovalHarness();

    await clickButton(container, 'Open saved version');
    const titleInput = container.querySelector(
      '[aria-label="Reviewed target title"]',
    ) as HTMLInputElement;
    await setInputValue(titleInput, editedVersion.title);
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Подтвердить версию',
      )?.disabled,
    ).toBe(true);

    await clickButton(container, 'Сохранить изменения');
    expect(updateResumeVersion).toHaveBeenNthCalledWith(1, versionId, {
      title: editedVersion.title,
      requirements: draftVersion.requirements,
      expectedRevision: draftVersion.revision,
      expectedMasterRevision: masterRevision,
    });
    expect(container.textContent).toContain('Черновик');
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Подтвердить версию',
      )?.disabled,
    ).toBe(false);

    await clickButton(container, 'Подтвердить версию');
    expect(updateResumeVersion).toHaveBeenNthCalledWith(2, versionId, {
      title: editedVersion.title,
      requirements: draftVersion.requirements,
      expectedRevision: editedVersion.revision,
      expectedMasterRevision: masterRevision,
      status: 'approved',
    });
    expect(container.textContent).toContain('Одобрено');
  });
});
