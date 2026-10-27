import {
  builderResumeSchema,
  RESUME_TEMPLATES,
  type BuilderResume,
  type ResumeTemplate,
} from '../../../../shared/resumeBuilder/model';

/**
 * B567: the builder keeps its document in this browser until sign-up, so
 * nothing typed is lost on the way through /signup and back. A later step
 * reads the pending export and hands the resume to the profile once.
 */
export const RESUME_BUILDER_STORAGE_KEY = 'openqareer:resume-builder:v1';

export type ExportFormat = 'pdf' | 'docx';

export interface StoredBuilderState {
  readonly resume: BuilderResume;
  readonly template: ResumeTemplate;
  /** Set when a signed-out visitor asked for a file; cleared once the profile has it. */
  readonly pendingExport?: ExportFormat;
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readBuilderState(): StoredBuilderState | undefined {
  try {
    const raw = storage()?.getItem(RESUME_BUILDER_STORAGE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<StoredBuilderState>;
    const resume = builderResumeSchema.safeParse(value.resume);
    if (!resume.success) return undefined;
    const template = RESUME_TEMPLATES.includes(value.template as ResumeTemplate)
      ? (value.template as ResumeTemplate)
      : 'strict';
    const pendingExport =
      value.pendingExport === 'pdf' || value.pendingExport === 'docx'
        ? value.pendingExport
        : undefined;
    return { resume: resume.data, template, ...(pendingExport ? { pendingExport } : {}) };
  } catch {
    return undefined;
  }
}

/** False when the browser refused to store it (private mode, full quota). */
export function writeBuilderState(state: StoredBuilderState): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(RESUME_BUILDER_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * Where sign-up, sign-in and e-mail confirmation lead: back to the builder
 * while it waits to hand over a file, otherwise the workspace.
 */
export function authReturnPath(search: string): string {
  const fromBuilder = new URLSearchParams(search).get('from') === 'resume';
  return fromBuilder || readBuilderState()?.pendingExport ? '/tools/resume' : '/app';
}
