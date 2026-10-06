import type { Page } from 'playwright';
import { isAllowedCandidateActionTarget } from '../../../shared/candidateActionPolicy';
import { HH_SELECTORS } from '../../connectors/hh/hhSelectors';
import type {
  CandidateActionItem,
  CandidateActionSession,
  PlatformActionRunner,
  RunnerOutcome,
} from '../candidateActionExecutor';
import { blockedPageReason, hasVisible, sameTargetRoute, withAllowedMainFrameNavigation } from './actionRunnerSafety';

const PROVIDER_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const ACTION_TIMEOUT_MS = 5_000;

export class HhActionRunner implements PlatformActionRunner {
  async run(item: CandidateActionItem, session: CandidateActionSession): Promise<RunnerOutcome> {
    if (session.platform !== 'hh') return { status: 'failed', failureCode: 'candidate_session_mismatch' };
    if (!isAllowedCandidateActionTarget('hh', item.targetUrl)) {
      return { status: 'failed', failureCode: 'target_not_allowed' };
    }
    if (item.actionKind === 'hh_resume_boost') return this.boostResume(item, session.page);
    if (item.actionKind !== 'hh_apply') return { status: 'failed', failureCode: 'action_kind_unsupported' };
    return this.apply(item, session.page);
  }

  private async apply(item: CandidateActionItem, page: Page): Promise<RunnerOutcome> {
    const vacancyId = vacancyIdFromUrl(item.targetUrl);
    if (!vacancyId) return { status: 'failed', failureCode: 'target_path_invalid' };
    if (!item.resumeId || !item.letterText?.trim()) {
      return { status: 'failed', failureCode: !item.resumeId ? 'resume_selection_required' : 'letter_required' };
    }
    return withAllowedMainFrameNavigation(page, 'hh', () => this.applyOnVacancy(item, vacancyId, page));
  }

  private async applyOnVacancy(
    item: CandidateActionItem,
    vacancyId: string,
    page: Page,
  ): Promise<RunnerOutcome> {
    const navigation = await navigateToTarget(page, item.targetUrl);
    if (navigation) return navigation;
    if (!sameTargetRoute(item.targetUrl, page.url())) return { status: 'failed', failureCode: 'target_redirect_rejected' };
    const block = await blockedPageReason(page);
    if (block) return { status: 'failed', failureCode: block };
    if (!(await hasVisible(page, HH_SELECTORS.security.applicantProfile))) {
      return { status: 'failed', failureCode: 'session_identity_unverified' };
    }
    if (await hasVisible(page, HH_SELECTORS.vacancy.alreadyAppliedBadge)) {
      return { status: 'failed', failureCode: 'already_applied_unverified' };
    }
    const opened = await this.openApplicationPopup(page);
    if (opened) return opened;
    const prepared = await this.prepareApplication(item, page);
    if (prepared) return prepared;
    if (!sameTargetRoute(item.targetUrl, page.url()) || (await blockedPageReason(page))) {
      return { status: 'failed', failureCode: 'pre_submit_surface_changed' };
    }
    return this.submitApplication(vacancyId, page);
  }

  private async openApplicationPopup(page: Page): Promise<RunnerOutcome | null> {
    const responseButton = await firstVisible(page, [
      HH_SELECTORS.vacancy.responseButtonTop,
      HH_SELECTORS.vacancy.responseButtonBottom,
    ]);
    if (!responseButton) return { status: 'failed', failureCode: 'response_action_missing' };
    try {
      await responseButton.click();
    } catch {
      return { status: 'failed', failureCode: 'response_action_failed' };
    }
    const block = await blockedPageReason(page);
    if (block) return { status: 'failed', failureCode: block };
    if (await hasVisible(page, HH_SELECTORS.apply.questionnaireWarning)) {
      return { status: 'failed', failureCode: 'questionnaire_required' };
    }
    return (await hasVisible(page, HH_SELECTORS.apply.popup))
      ? null
      : { status: 'failed', failureCode: 'application_surface_unexpected' };
  }

  private async prepareApplication(item: CandidateActionItem, page: Page): Promise<RunnerOutcome | null> {
    const availableResumes = page.locator(HH_SELECTORS.apply.resumeRadio);
    const resume = item.resumeId
      ? page.locator(`${HH_SELECTORS.apply.resumeRadio}[data-resume-id="${escapeCssAttribute(item.resumeId)}"]`)
      : availableResumes;
    if ((await resume.count()) !== 1 || !(await resume.isVisible().catch(() => false))) {
      return { status: 'failed', failureCode: 'approved_resume_missing' };
    }
    try {
      await resume.click();
      const textarea = page.locator(HH_SELECTORS.apply.letterTextarea);
      if (!(await textarea.isVisible().catch(() => false))) {
        const toggle = page.locator(HH_SELECTORS.apply.letterToggle);
        if (!(await toggle.isVisible().catch(() => false))) {
          return { status: 'failed', failureCode: 'letter_field_missing' };
        }
        await toggle.click();
      }
      await textarea.fill(item.letterText ?? '');
      return null;
    } catch {
      return { status: 'failed', failureCode: 'application_form_prepare_failed' };
    }
  }

  private async submitApplication(_vacancyId: string, page: Page): Promise<RunnerOutcome> {
    const submit = page.locator(HH_SELECTORS.apply.submitButton);
    if ((await submit.count()) !== 1 || !(await submit.isVisible().catch(() => false))) {
      return { status: 'failed', failureCode: 'submit_action_missing' };
    }
    try {
      await submit.click();
    } catch {
      return { status: 'attempted', failureCode: 'submit_result_uncertain' };
    }
    const success = page.locator(HH_SELECTORS.apply.success);
    try {
      await success.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
    } catch {
      const block = await blockedPageReason(page);
      return { status: 'attempted', failureCode: block ?? 'provider_confirmation_missing' };
    }
    const reference = await success.getAttribute('data-response-id').catch(() => null);
    if (!reference || !PROVIDER_REFERENCE_PATTERN.test(reference)) {
      return { status: 'attempted', failureCode: 'provider_reference_missing' };
    }
    return { status: 'delivered', providerStatus: 'hh_response_submitted' };
  }

  private async boostResume(item: CandidateActionItem, page: Page): Promise<RunnerOutcome> {
    const resumePath = new URL(item.targetUrl).pathname;
    if (!/^\/applicant\/resumes(?:\/|$)/u.test(resumePath)) {
      return { status: 'failed', failureCode: 'target_path_invalid' };
    }
    return withAllowedMainFrameNavigation(page, 'hh', async () => {
      const navigation = await navigateToTarget(page, item.targetUrl);
      if (navigation) return navigation;
      if (!/^\/applicant\/resumes(?:\/|$)/u.test(new URL(page.url()).pathname)) {
        return { status: 'failed', failureCode: 'target_redirect_rejected' };
      }
      const block = await blockedPageReason(page);
      if (block) return { status: 'failed', failureCode: block };
      if (!(await hasVisible(page, HH_SELECTORS.security.applicantProfile))) {
        return { status: 'failed', failureCode: 'session_identity_unverified' };
      }
      return this.clickResumeBoost(item.resumeId ?? undefined, page);
    });
  }

  private async clickResumeBoost(resumeId: string | undefined, page: Page): Promise<RunnerOutcome> {
    const card = resumeId
      ? page.locator(
          `${HH_SELECTORS.resume.card}:has(a[href*="${escapeCssAttribute(resumeId)}"]), ${HH_SELECTORS.resume.card}[data-resume-id="${escapeCssAttribute(resumeId)}"]`,
        )
      : page.locator(HH_SELECTORS.resume.card);
    if ((await card.count()) !== 1) return { status: 'failed', failureCode: 'resume_card_missing' };
    const updatedAt = card.locator(HH_SELECTORS.resume.nextPublishTime);
    const previousLabel = await updatedAt.innerText().catch(() => '');
    const updateButton = card.locator(HH_SELECTORS.resume.updateDateButton);
    if (!(await updateButton.isVisible().catch(() => false))) {
      return { status: 'failed', failureCode: 'resume_update_action_missing' };
    }
    try {
      await updateButton.click();
    } catch {
      return { status: 'attempted', failureCode: 'resume_update_result_uncertain' };
    }
    const updated = await waitForResumeUpdate(page, updatedAt, previousLabel);
    return updated
      ? { status: 'delivered', providerStatus: 'hh_resume_updated' }
      : { status: 'attempted', failureCode: 'provider_confirmation_missing' };
  }
}

async function navigateToTarget(page: Page, targetUrl: string): Promise<RunnerOutcome | null> {
  let response;
  try {
    response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } catch {
    return {
      status: 'failed',
      failureCode: isAllowedCandidateActionTarget('hh', page.url())
        ? 'platform_unavailable'
        : 'target_redirect_rejected',
    };
  }
  if (response?.status() === 403) return { status: 'failed', failureCode: 'http_403' };
  if (response && response.status() >= 400) return { status: 'failed', failureCode: 'platform_unavailable' };
  return null;
}

async function firstVisible(page: Page, selectors: readonly string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false))) {
      return locator.first();
    }
  }
  return null;
}

async function waitForResumeUpdate(
  page: Page,
  updatedAt: ReturnType<Page['locator']>,
  previousLabel: string,
): Promise<boolean> {
  const selector = HH_SELECTORS.resume.nextPublishTime;
  try {
    await page.waitForFunction(
      ({ selector: currentSelector, previous }) => {
        const label = document.querySelector(currentSelector)?.textContent?.trim() ?? '';
        return label.length > 0 && label !== previous;
      },
      { selector, previous: previousLabel },
      { timeout: ACTION_TIMEOUT_MS },
    );
    return (await updatedAt.innerText()).trim() !== previousLabel;
  } catch {
    return false;
  }
}

function vacancyIdFromUrl(targetUrl: string): string | null {
  try {
    return new URL(targetUrl).pathname.match(/^\/vacancy\/(\d+)(?:\/|$)/u)?.[1] ?? null;
  } catch {
    return null;
  }
}

function escapeCssAttribute(value: string): string {
  return value.replace(/["\\]/gu, '\\$&');
}
