import type { Locator, Page } from 'playwright';
import { isAllowedCandidateActionTarget } from '../../../shared/candidateActionPolicy';
import type {
  CandidateActionItem,
  CandidateActionSession,
  PlatformActionRunner,
  RunnerOutcome,
} from '../candidateActionExecutor';
import { blockedPageReason, hasVisible, sameTargetRoute, withAllowedMainFrameNavigation } from './actionRunnerSafety';

const ACTION_TIMEOUT_MS = 5_000;
const MAX_FORM_STEPS = 6;

export class LinkedinEasyApplyRunner implements PlatformActionRunner {
  async run(item: CandidateActionItem, session: CandidateActionSession): Promise<RunnerOutcome> {
    if (session.platform !== 'linkedin') return { status: 'failed', failureCode: 'candidate_session_mismatch' };
    if (item.actionKind !== 'linkedin_easy_apply') return { status: 'failed', failureCode: 'action_kind_unsupported' };
    if (!isAllowedCandidateActionTarget('linkedin', item.targetUrl)) {
      return { status: 'failed', failureCode: 'target_not_allowed' };
    }
    if (!linkedinJobId(item.targetUrl)) return { status: 'failed', failureCode: 'target_path_invalid' };
    return withAllowedMainFrameNavigation(session.page, 'linkedin', () =>
      this.applyToJob(item, session.page),
    );
  }

  private async applyToJob(item: CandidateActionItem, page: Page): Promise<RunnerOutcome> {
    const navigation = await navigateToJob(page, item.targetUrl);
    if (navigation) return navigation;
    const block = await blockedPageReason(page);
    if (block) return { status: 'failed', failureCode: block };
    if (!(await hasVisible(page, 'header.global-nav, nav.global-nav, [data-test-global-nav]'))) {
      return { status: 'failed', failureCode: 'session_identity_unverified' };
    }
    const easyApply = page.getByRole('button', { name: /^easy apply$/iu });
    if ((await easyApply.count()) !== 1 || !(await easyApply.isVisible().catch(() => false))) {
      return { status: 'failed', failureCode: 'easy_apply_action_missing' };
    }
    try {
      await easyApply.click();
    } catch {
      return { status: 'failed', failureCode: 'easy_apply_open_failed' };
    }
    return this.completeApplicationForm(item, page);
  }

  private async completeApplicationForm(item: CandidateActionItem, page: Page): Promise<RunnerOutcome> {
    const block = await blockedPageReason(page);
    if (block) return { status: 'failed', failureCode: block };
    const dialog = page.getByRole('dialog');
    if ((await dialog.count()) !== 1 || !(await dialog.isVisible().catch(() => false))) {
      return { status: 'failed', failureCode: 'application_surface_unexpected' };
    }
    const preparation = await this.prepareKnownFields(item, dialog);
    if (preparation) return preparation;
    for (let step = 0; step < MAX_FORM_STEPS; step += 1) {
      const submitted = await this.submitIfReady(dialog, page);
      if (submitted) return submitted;
      if (await hasUnfilledRequiredFields(dialog)) {
        return { status: 'failed', failureCode: 'candidate_input_required' };
      }
      const next = await nextFormAction(dialog);
      if (!next) return { status: 'failed', failureCode: 'application_form_unexpected' };
      try {
        await next.click();
      } catch {
        return { status: 'failed', failureCode: 'application_form_step_failed' };
      }
      const stepBlock = await blockedPageReason(page);
      if (stepBlock) return { status: 'failed', failureCode: stepBlock };
    }
    return { status: 'failed', failureCode: 'application_form_step_limit' };
  }

  private async prepareKnownFields(item: CandidateActionItem, dialog: Locator): Promise<RunnerOutcome | null> {
    if (item.resumeId) {
      const resume = dialog.locator(`input[type="radio"][value="${escapeCssAttribute(item.resumeId)}"]`);
      if ((await resume.count()) === 1) await resume.check().catch(() => undefined);
      else return { status: 'failed', failureCode: 'approved_resume_missing' };
    }
    if (item.letterText?.trim()) {
      const textareas = dialog.locator('textarea');
      if ((await textareas.count()) !== 1) return { status: 'failed', failureCode: 'letter_field_unavailable' };
      try {
        await textareas.fill(item.letterText);
      } catch {
        return { status: 'failed', failureCode: 'letter_field_fill_failed' };
      }
    }
    return null;
  }

  private async submitIfReady(dialog: Locator, page: Page): Promise<RunnerOutcome | null> {
    const submit = dialog.getByRole('button', { name: /^submit application$/iu });
    if ((await submit.count()) === 0 || !(await submit.isVisible().catch(() => false))) return null;
    if (await hasUnfilledRequiredFields(dialog)) return { status: 'failed', failureCode: 'candidate_input_required' };
    const block = await blockedPageReason(page);
    if (block) return { status: 'failed', failureCode: block };
    try {
      await submit.click();
    } catch {
      return { status: 'attempted', failureCode: 'submit_result_uncertain' };
    }
    const confirmed = await waitForApplicationConfirmation(dialog);
    return confirmed
      ? { status: 'delivered', providerStatus: 'linkedin_application_submitted' }
      : { status: 'attempted', failureCode: (await blockedPageReason(page)) ?? 'provider_confirmation_missing' };
  }
}

async function navigateToJob(page: Page, targetUrl: string): Promise<RunnerOutcome | null> {
  let response;
  try {
    response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } catch {
    return { status: 'failed', failureCode: 'platform_unavailable' };
  }
  if (response?.status() === 403) return { status: 'failed', failureCode: 'http_403' };
  if (response && response.status() >= 400) return { status: 'failed', failureCode: 'platform_unavailable' };
  return sameTargetRoute(targetUrl, page.url()) ? null : { status: 'failed', failureCode: 'target_redirect_rejected' };
}

async function hasUnfilledRequiredFields(dialog: Locator): Promise<boolean> {
  return dialog.locator('input[required], textarea[required], select[required]').evaluateAll((fields) =>
    fields.some((field) => {
      if (field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type)) {
        return !field.checked;
      }
      return !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)
        || !field.value.trim();
    }),
  );
}

async function nextFormAction(dialog: Locator): Promise<Locator | null> {
  for (const name of [/^next$/iu, /^review$/iu]) {
    const button = dialog.getByRole('button', { name });
    if ((await button.count()) === 1 && (await button.isVisible().catch(() => false))) return button;
  }
  return null;
}

async function waitForApplicationConfirmation(dialog: Locator): Promise<boolean> {
  const confirmation = dialog.getByText(/application sent|your application was sent|application submitted/iu);
  try {
    await confirmation.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

function linkedinJobId(targetUrl: string): string | null {
  try {
    return new URL(targetUrl).pathname.match(/^\/jobs\/view\/(\d+)(?:\/|$)/u)?.[1] ?? null;
  } catch {
    return null;
  }
}

function escapeCssAttribute(value: string): string {
  return value.replace(/["\\]/gu, '\\$&');
}
