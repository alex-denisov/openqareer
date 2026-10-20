// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumeAtsAssessment } from '../../../server/domain/resumeAtsAssessment';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import { buildTargetedResumeSlice } from '../../../server/domain/resumeStudio';
import type {
  ResumeVersionSummary,
  StoredResumeVersion,
} from '../../../server/domain/resumeVersions';
import type { ResumeVersionCreateInput, ResumeVersionUpdateInput } from './resumeVersionsApi';
import { ProfileAtsAssessment } from './ProfileReviewAndVersions';
import { ProfileResumeVersions } from './ProfileReviewAndVersions';
import { previewProjection, selectDocument } from './resumeStudioModel';
import { estimateResumePages } from './targetedResumeVolume';
import { useProfileAtsAssessment } from './useProfileAtsAssessment';

const api = vi.hoisted(() => ({
  createResumeVersion: vi.fn(),
  getResumeAtsAssessment: vi.fn(),
  getResumeVersion: vi.fn(),
  getResumeVersions: vi.fn(),
  updateResumeVersion: vi.fn(),
}));

vi.mock('./resumeVersionsApi', () => api);

const coach = vi.hoisted(() => ({ getRoleHypotheses: vi.fn() }));
vi.mock('../coach/coachApi', () => coach);

const unknownDimension = (maximum: number) => ({
  score: null,
  maximum,
  status: 'unknown' as const,
  source: 'Источник отсутствует',
  sampleSize: 0,
  summary: 'Нет данных',
});

const unknownAssessment: ResumeAtsAssessment = {
  total: { score: null, maximum: 100, status: 'partial' },
  dimensions: {
    structure: unknownDimension(25),
    keywords: unknownDimension(30),
    dates: unknownDimension(20),
    format: unknownDimension(25),
  },
  context: {
    resumeUpdatedAt: null,
    resumeSourceRevision: null,
    requirementSource: null,
  },
  evaluatedAt: '2026-10-17T09:30:00.000Z',
  disclaimer: 'Оценка не гарантирует прохождение отбора.',
};

const measuredAssessment: ResumeAtsAssessment = {
  ...unknownAssessment,
  total: { score: 85, maximum: 100, status: 'measured' },
  dimensions: {
    structure: { ...unknownDimension(25), score: 25, status: 'measured', sampleSize: 5 },
    keywords: {
      ...unknownDimension(30),
      score: 15,
      status: 'measured',
      source: 'Platform Engineer',
      sampleSize: 2,
      summary: 'Совпало 1 из 2 требований.',
      matchedRequirements: ['Kubernetes'],
      unmatchedRequirements: ['Terraform'],
      evidence: [
        {
          requirement: 'Kubernetes',
          matches: [{ field: 'Навыки', text: 'Kubernetes' }],
        },
        { requirement: 'Terraform', matches: [] },
      ],
    },
    dates: { ...unknownDimension(20), score: 20, status: 'measured', sampleSize: 1 },
    format: { ...unknownDimension(25), score: 25, status: 'measured', sampleSize: 12 },
  },
  context: {
    resumeUpdatedAt: '2026-10-17T09:00:00.000Z',
    resumeSourceRevision: 'master-revision-current',
    requirementSource: {
      kind: 'candidate_input',
      label: 'Platform Engineer',
      capturedAt: '2026-10-17T09:15:00.000Z',
    },
  },
};

const matchingVersion: ResumeVersionSummary = {
  id: 'version-current',
  title: 'Platform Engineer',
  requirements: ['Kubernetes', 'Terraform'],
  status: 'draft',
  revision: 2,
  sourceMasterRevision: 'master-revision-current',
  createdAt: '2026-10-17T09:00:00.000Z',
  updatedAt: '2026-10-17T09:15:00.000Z',
};

const staleVersion: ResumeVersionSummary = {
  ...matchingVersion,
  id: 'version-stale',
  title: 'Older Platform Engineer',
  sourceMasterRevision: 'master-revision-old',
};

const storedVersions = new Map<string, StoredResumeVersion>();
const VERSION_ID = '123e4567-e89b-12d3-a456-426614174001';
const MASTER_REVISION = 'master-revision-current';
const TARGET_DRAFT = {
  ...EMPTY_RESUME_DRAFT,
  candidate: {
    ...EMPTY_RESUME_DRAFT.candidate,
    fullName: 'Mila Example',
    contact: {
      ...EMPTY_RESUME_DRAFT.candidate.contact,
      email: 'mila@example.test',
    },
  },
};

function makeSnapshot(title: string, requirements: readonly string[]) {
  const document = selectDocument(previewProjection(TARGET_DRAFT, []), 'master');
  return estimateResumePages(buildTargetedResumeSlice(document, { title, requirements }));
}

function makeStoredVersion(
  title: string,
  requirements: readonly string[],
  revision = 1,
): StoredResumeVersion {
  const timestamp = revision === 1 ? '2026-10-17T09:00:00.000Z' : '2026-10-17T09:15:00.000Z';
  return {
    id: VERSION_ID,
    title,
    requirements,
    status: 'draft',
    snapshot: makeSnapshot(title, requirements),
    revision,
    sourceMasterRevision: MASTER_REVISION,
    createdAt: '2026-10-17T09:00:00.000Z',
    updatedAt: timestamp,
  };
}

function toVersionSummary(version: StoredResumeVersion): ResumeVersionSummary {
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

async function flushAsyncWork() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function AssessmentHarness() {
  const { assessment, sourceVersion, roleBasis, loading, error } = useProfileAtsAssessment();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="assessment">{assessment?.total.score ?? 'unknown'}</span>
      <span data-testid="source-version">{sourceVersion?.title ?? 'none'}</span>
      <span data-testid="error">{error ?? 'none'}</span>
      <span data-testid="role-basis">{roleBasis ?? 'none'}</span>
    </div>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  storedVersions.clear();
  api.getResumeVersions.mockResolvedValue({
    items: [],
    nextCursor: null,
    totalCount: 0,
    currentMasterRevision: 'master-revision-current',
  });
  api.getResumeAtsAssessment.mockResolvedValue(unknownAssessment);
  coach.getRoleHypotheses.mockResolvedValue([]);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function mount(node: ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

describe('useProfileAtsAssessment', () => {
  it('scores the newest saved version based on the current master revision', async () => {
    api.getResumeVersions.mockResolvedValue({
      items: [staleVersion, matchingVersion],
      nextCursor: null,
      totalCount: 2,
      currentMasterRevision: 'master-revision-current',
    });
    api.getResumeAtsAssessment.mockResolvedValue(measuredAssessment);
    const mounted = mount(<AssessmentHarness />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.getResumeAtsAssessment).toHaveBeenCalledWith(
      { versionId: 'version-current' },
      expect.any(AbortSignal),
    );
    expect(mounted.querySelector('[data-testid="assessment"]')?.textContent).toBe('85');
    expect(mounted.querySelector('[data-testid="source-version"]')?.textContent).toBe(
      'Platform Engineer',
    );
    expect(mounted.querySelector('[data-testid="loading"]')?.textContent).toBe('false');
  });

  it('keeps keyword context unknown when there is no current saved version', async () => {
    api.getResumeVersions.mockResolvedValue({
      items: [staleVersion],
      nextCursor: null,
      totalCount: 1,
      currentMasterRevision: 'master-revision-current',
    });
    const mounted = mount(<AssessmentHarness />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.getResumeAtsAssessment).toHaveBeenCalledWith({}, expect.any(AbortSignal));
    expect(mounted.querySelector('[data-testid="assessment"]')?.textContent).toBe('unknown');
    expect(mounted.querySelector('[data-testid="source-version"]')?.textContent).toBe('none');
  });
});

describe('ProfileAtsAssessment', () => {
  it('shows an unknown dash instead of a fabricated score', () => {
    const markup = renderToStaticMarkup(<ProfileAtsAssessment assessment={unknownAssessment} />);

    expect(markup).toContain('Оценка ATS неизвестна');
    expect(markup).toContain('—');
    const visibleScore = markup.match(
      /class="career-profile-screen-ats-value"[^>]*>([^<]*)</u,
    )?.[1];
    expect(visibleScore).toBe('—');
  });

  it('renders the measured score, source, sample, time, and exact keyword evidence', () => {
    const markup = renderToStaticMarkup(
      <ProfileAtsAssessment assessment={measuredAssessment} sourceVersion={matchingVersion} />,
    );

    expect(markup).toContain('85');
    expect(markup).toContain('из 100');
    expect(markup).toContain('Ключевые слова');
    expect(markup).toContain('выборка: 2');
    expect(markup).toContain('Kubernetes');
    expect(markup).toContain('без точного текстового совпадения');
    expect(markup).toContain('Platform Engineer');
    expect(markup).toContain('2026');
  });
});

describe('ProfileResumeVersions persistence handlers', () => {
  it('creates, reopens after remount, and edits the version through API handlers', async () => {
    api.getResumeVersions.mockImplementation(async () => ({
      items: [...storedVersions.values()].map(toVersionSummary),
      nextCursor: null,
      totalCount: storedVersions.size,
      currentMasterRevision: MASTER_REVISION,
    }));
    api.createResumeVersion.mockImplementation(async (input: ResumeVersionCreateInput) => {
      const version = makeStoredVersion(input.title, input.requirements);
      storedVersions.set(version.id, version);
      return { version, currentMasterRevision: MASTER_REVISION };
    });
    api.getResumeVersion.mockImplementation(async (versionId: string) => {
      const version = storedVersions.get(versionId);
      if (!version) throw new Error('Версия не найдена.');
      return { version, currentMasterRevision: MASTER_REVISION };
    });
    api.updateResumeVersion.mockImplementation(
      async (versionId: string, input: ResumeVersionUpdateInput) => {
        const existing = storedVersions.get(versionId);
        if (!existing || existing.revision !== input.expectedRevision) {
          throw new Error('Версия изменилась.');
        }
        const version = makeStoredVersion(input.title, input.requirements, existing.revision + 1);
        storedVersions.set(versionId, version);
        return { version, currentMasterRevision: MASTER_REVISION };
      },
    );
    api.getResumeAtsAssessment.mockResolvedValue(unknownAssessment);

    let mounted = mount(<ProfileResumeVersions draft={TARGET_DRAFT} memory={[]} />);
    await flushAsyncWork();
    act(() =>
      (mounted.querySelector('button[aria-controls="docs-more"]') as HTMLButtonElement).click(),
    );

    const createButton = mounted.querySelector(
      '[data-testid="create-targeted-version-btn"]',
    ) as HTMLButtonElement;
    act(() => createButton.click());
    const createTitle = mounted.querySelector(
      '[data-testid="targeted-version-input"]',
    ) as HTMLInputElement;
    const createRequirements = mounted.querySelector(
      '[data-testid="targeted-version-requirements"]',
    ) as HTMLTextAreaElement;
    setFieldValue(createTitle, 'Platform Engineer');
    setFieldValue(createRequirements, 'Kubernetes');
    const createSubmit = mounted.querySelector(
      '[data-testid="submit-targeted-version-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      createSubmit.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.createResumeVersion).toHaveBeenCalledWith(
      {
        title: 'Platform Engineer',
        requirements: ['Kubernetes'],
        expectedMasterRevision: MASTER_REVISION,
      },
      expect.any(String),
    );
    expect(mounted.textContent).toContain('Версия под вакансию «Platform Engineer»');
    expect(mounted.textContent).toContain('Kubernetes');

    act(() => root?.unmount());
    root = null;
    mounted.remove();
    mounted = mount(<ProfileResumeVersions draft={TARGET_DRAFT} memory={[]} />);
    await flushAsyncWork();

    const openButton = mounted.querySelector(
      `[data-testid="open-targeted-version-${VERSION_ID}"]`,
    ) as HTMLButtonElement;
    expect(openButton).not.toBeNull();
    await act(async () => {
      openButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.getResumeVersion).toHaveBeenCalledWith(VERSION_ID);
    expect(mounted.textContent).toContain('Mila Example');

    const editTitle = mounted.querySelector(
      '.career-resume-ats-targeting input',
    ) as HTMLInputElement;
    const editRequirements = mounted.querySelector(
      '.career-resume-ats-targeting textarea',
    ) as HTMLTextAreaElement;
    setFieldValue(editTitle, 'Platform Engineer II');
    setFieldValue(editRequirements, 'Kubernetes\nTerraform');
    const updateSubmit = [...mounted.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Сохранить версию',
    ) as HTMLButtonElement;
    await act(async () => {
      updateSubmit.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.updateResumeVersion).toHaveBeenCalledWith(VERSION_ID, {
      title: 'Platform Engineer II',
      requirements: ['Kubernetes', 'Terraform'],
      expectedRevision: 1,
      expectedMasterRevision: MASTER_REVISION,
    });
    expect(mounted.textContent).toContain('Версия под вакансию «Platform Engineer II»');
    expect(storedVersions.get(VERSION_ID)?.revision).toBe(2);
  });
});

describe('useProfileAtsAssessment by role (макет 2 «ATS: нет избранных вакансий»)', () => {
  it('measures keywords by the Career role when no targeted version exists', async () => {
    coach.getRoleHypotheses.mockResolvedValue([
      {
        id: 'r1',
        title: 'Head of Engineering',
        origin: 'market',
        reason: null,
        evidenceRefs: [],
        family: null,
        confirmation: {
          state: 'observed',
          sampleSize: 40,
          observedFrom: '2026-09-01',
          observedTo: '2026-10-01',
          sources: [{ source: 'hh', count: 40 }],
          repeatedRequirements: ['Kafka'],
          matchedRequirements: 0,
        },
      },
    ]);
    const mounted = mount(<AssessmentHarness />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.getResumeAtsAssessment).toHaveBeenCalledWith(
      { title: 'По роли «Head of Engineering»', requirements: ['Kafka'] },
      expect.any(AbortSignal),
    );
    expect(mounted.querySelector('[data-testid="role-basis"]')?.textContent).toBe(
      'Head of Engineering',
    );
  });

  it('keeps the old request when roles cannot be read', async () => {
    coach.getRoleHypotheses.mockRejectedValue(new Error('offline'));
    const mounted = mount(<AssessmentHarness />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.getResumeAtsAssessment).toHaveBeenCalledWith({}, expect.any(AbortSignal));
    expect(mounted.querySelector('[data-testid="role-basis"]')?.textContent).toBe('none');
  });

  it('shows candidate copy, not an engine message, when the assessment fails (B536)', async () => {
    api.getResumeAtsAssessment.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'assessment')"),
    );
    const mounted = mount(<AssessmentHarness />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const error = mounted.querySelector('[data-testid="error"]')?.textContent ?? '';
    expect(error).toBe('Не удалось обновить оценку ATS.');
  });
});
