import { z } from 'zod';
import type { Locator, Page } from 'playwright';
import type {
  ConnectorExecutor,
  ConnectorReceipt,
  ConnectorRequest,
} from '../connectorHarness';
import type { CareerCommandExecutionTarget } from '../../orchestration/careerCommandPlanner';
import { hhExecutionPayloadSchema } from './hhConnector';
import { HH_SELECTORS } from './hhSelectors';

type HhApplicationExecutionTarget = CareerCommandExecutionTarget;

const providerReferenceSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export interface HhApplicationBrowserSessionOptions {
  candidateId: string;
  page: Page;
  now?: () => string;
}

/**
 * One already-authenticated hh.ru page, isolated for exactly one candidate.
 *
 * The server-side command repository remains the authority for approval and
 * at-most-once dispatch. This boundary independently checks the immutable
 * approval/command/target envelope before it touches the candidate's page and
 * reports completion only from an explicit post-submit DOM confirmation.
 */
export class HhApplicationBrowserSession implements ConnectorExecutor {
  readonly connectorId = 'hh-browser-session';
  readonly transport = 'browser_session' as const;
  private readonly candidateId: string;
  private readonly page: Page;
  private readonly now: () => string;

  constructor(options: HhApplicationBrowserSessionOptions) {
    this.candidateId = options.candidateId;
    this.page = options.page;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async execute(request: ConnectorRequest): Promise<ConnectorReceipt> {
    const envelope = this.checkApprovalEnvelope(request);
    if ('receipt' in envelope) return envelope.receipt;
    const target = envelope.target;

    return (
      (await this.openApprovedVacancy(request, target)) ??
      (await this.openApplicationSurface(request)) ??
      (await this.selectApprovedResume(request, target)) ??
      (await this.fillApprovedMessage(request, target)) ??
      (await this.recheckBeforeSubmit(request, target)) ??
      (await this.submitAndConfirm(request))
    );
  }

  /** Nothing touches the browser until this exact envelope checks out. */
  private checkApprovalEnvelope(
    request: ConnectorRequest,
  ): { target: HhApplicationExecutionTarget } | { receipt: ConnectorReceipt } {
    if (request.candidateId !== this.candidateId) {
      return {
        receipt: this.paused(
          request,
          'hh_candidate_session_mismatch',
          'session_state',
          'candidate-session-mismatch',
        ),
      };
    }
    if (request.action !== 'application') {
      return {
        receipt: this.paused(
          request,
          'hh_action_unsupported',
          'unexpected',
          'unsupported-action',
        ),
      };
    }
    const payload = hhExecutionPayloadSchema.safeParse(request.payload);
    if (
      !payload.success ||
      payload.data.commandId !== request.idempotencyKey ||
      request.opportunityId !==
        `hh:vacancy:${payload.data.executionTarget.vacancyId}`
    ) {
      return {
        receipt: this.paused(
          request,
          'hh_approval_binding_invalid',
          'unexpected',
          'approval-envelope-invalid',
        ),
      };
    }
    return { target: payload.data.executionTarget };
  }

  private async openApprovedVacancy(
    request: ConnectorRequest,
    target: HhApplicationExecutionTarget,
  ): Promise<ConnectorReceipt | null> {
    try {
      await this.page.goto(`https://hh.ru/vacancy/${target.vacancyId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
    } catch {
      return this.paused(
        request,
        'hh_navigation_failed',
        'unexpected',
        'vacancy-navigation-failed',
      );
    }
    if (!isExactVacancyUrl(this.page.url(), target.vacancyId)) {
      return this.paused(
        request,
        'hh_target_mismatch',
        'unexpected',
        'vacancy-url-mismatch',
      );
    }
    if (await this.challengeVisible()) {
      return this.challengeStop(request);
    }
    if (
      !(await isVisible(this.page.locator(HH_SELECTORS.security.applicantProfile)))
    ) {
      return this.paused(
        request,
        'hh_session_identity_unverified',
        'session_state',
        'applicant-profile-missing',
      );
    }
    if (
      await isVisible(this.page.locator(HH_SELECTORS.vacancy.alreadyAppliedBadge))
    ) {
      return this.paused(
        request,
        'hh_already_applied_unverified',
        'confirmation_missing',
        'already-applied-without-reference',
      );
    }
    return null;
  }

  private async openApplicationSurface(
    request: ConnectorRequest,
  ): Promise<ConnectorReceipt | null> {
    const responseButton = await firstVisible([
      this.page.locator(HH_SELECTORS.vacancy.responseButtonTop),
      this.page.locator(HH_SELECTORS.vacancy.responseButtonBottom),
    ]);
    if (!responseButton) {
      return this.paused(
        request,
        'hh_response_action_missing',
        'unexpected',
        'response-button-missing',
      );
    }
    try {
      await responseButton.click();
    } catch {
      return this.paused(
        request,
        'hh_response_action_failed',
        'unexpected',
        'response-button-failed',
      );
    }
    if (await this.challengeVisible()) {
      return this.challengeStop(request);
    }
    const questionnaire = await this.questionnaireStop(request);
    if (questionnaire) return questionnaire;
    if (!(await isVisible(this.page.locator(HH_SELECTORS.apply.popup)))) {
      return this.paused(
        request,
        'hh_application_surface_missing',
        'unexpected',
        'application-popup-missing',
      );
    }
    return null;
  }

  private async selectApprovedResume(
    request: ConnectorRequest,
    target: HhApplicationExecutionTarget,
  ): Promise<ConnectorReceipt | null> {
    const resume = this.page.locator(
      `${HH_SELECTORS.apply.resumeRadio}[data-resume-id="${target.resumeId}"]`,
    );
    if (!(await isVisible(resume))) {
      return this.paused(
        request,
        'hh_resume_target_missing',
        'unexpected',
        'approved-resume-missing',
      );
    }
    try {
      await resume.click();
    } catch {
      return this.paused(
        request,
        'hh_resume_selection_failed',
        'unexpected',
        'approved-resume-not-selectable',
      );
    }
    return null;
  }

  private async fillApprovedMessage(
    request: ConnectorRequest,
    target: HhApplicationExecutionTarget,
  ): Promise<ConnectorReceipt | null> {
    if (!target.message) return null;
    const textarea = this.page.locator(HH_SELECTORS.apply.letterTextarea);
    if (!(await isVisible(textarea))) {
      const toggle = this.page.locator(HH_SELECTORS.apply.letterToggle);
      if (!(await isVisible(toggle))) {
        return this.paused(
          request,
          'hh_message_field_missing',
          'unexpected',
          'approved-message-field-missing',
        );
      }
      await toggle.click();
    }
    try {
      await textarea.fill(target.message);
    } catch {
      return this.paused(
        request,
        'hh_message_fill_failed',
        'unexpected',
        'approved-message-not-filled',
      );
    }
    return null;
  }

  /** hh.ru may swap the surface while the form is being filled in. */
  private async recheckBeforeSubmit(
    request: ConnectorRequest,
    target: HhApplicationExecutionTarget,
  ): Promise<ConnectorReceipt | null> {
    if (
      !isExactVacancyUrl(this.page.url(), target.vacancyId) ||
      (await this.challengeVisible())
    ) {
      return this.paused(
        request,
        'hh_pre_submit_recheck_failed',
        'challenge',
        'pre-submit-surface-changed',
      );
    }
    return this.questionnaireStop(request);
  }

  private async submitAndConfirm(
    request: ConnectorRequest,
  ): Promise<ConnectorReceipt> {
    const submit = this.page.locator(HH_SELECTORS.apply.submitButton);
    if (!(await isVisible(submit))) {
      return this.paused(
        request,
        'hh_submit_action_missing',
        'unexpected',
        'submit-button-missing',
      );
    }
    try {
      await submit.click();
    } catch {
      return this.paused(
        request,
        'hh_submit_action_failed',
        'unexpected',
        'submit-click-failed',
      );
    }

    return this.readConfirmation(request);
  }

  /** Completion is claimed only from hh.ru's own post-submit reference. */
  private async readConfirmation(
    request: ConnectorRequest,
  ): Promise<ConnectorReceipt> {
    const confirmation = this.page.locator(HH_SELECTORS.apply.success);
    try {
      await confirmation.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      return this.paused(
        request,
        'hh_confirmation_missing',
        'confirmation_missing',
        'post-submit-confirmation-missing',
      );
    }
    const providerReference = providerReferenceSchema.safeParse(
      await confirmation.getAttribute('data-response-id'),
    );
    if (!providerReference.success) {
      return this.paused(
        request,
        'hh_confirmation_missing',
        'confirmation_missing',
        'post-submit-reference-invalid',
      );
    }

    return {
      connectorId: this.connectorId,
      transport: this.transport,
      action: request.action,
      status: 'completed',
      idempotencyKey: request.idempotencyKey,
      opportunityId: request.opportunityId,
      providerReference: providerReference.data,
      evidence: { kind: 'dom_confirmation', observedAt: this.now() },
    };
  }

  private challengeStop(request: ConnectorRequest): ConnectorReceipt {
    return this.paused(
      request,
      'challenge_required',
      'challenge',
      'hh-robot-challenge',
    );
  }

  private async questionnaireStop(
    request: ConnectorRequest,
  ): Promise<ConnectorReceipt | null> {
    if (
      await isVisible(this.page.locator(HH_SELECTORS.apply.questionnaireWarning))
    ) {
      return this.paused(
        request,
        'hh_questionnaire_required',
        'unexpected',
        'employer-questionnaire',
      );
    }
    return null;
  }

  private async challengeVisible(): Promise<boolean> {
    const title = await this.page.title().catch(() => '');
    return (
      /(captcha|robot|робот|проверка|challenge)/iu.test(title) ||
      (await isVisible(this.page.locator(HH_SELECTORS.security.captchaContainer)))
    );
  }

  private paused(
    request: ConnectorRequest,
    reason: string,
    surfaceState: 'challenge' | 'unexpected' | 'confirmation_missing' | 'session_state',
    surfaceFingerprint: string,
  ): ConnectorReceipt {
    return {
      connectorId: this.connectorId,
      transport: this.transport,
      action: request.action,
      status: 'paused',
      idempotencyKey: request.idempotencyKey,
      opportunityId: request.opportunityId,
      evidence: null,
      diagnostic: {
        reason,
        surfaceState,
        observedAt: this.now(),
        surfaceFingerprint,
      },
    };
  }
}

async function isVisible(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0 && locator.first().isVisible();
}

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    if (await isVisible(locator)) return locator.first();
  }
  return null;
}

function isExactVacancyUrl(value: string, vacancyId: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.hostname === 'hh.ru' || url.hostname === 'www.hh.ru') &&
      url.pathname === `/vacancy/${vacancyId}`
    );
  } catch {
    return false;
  }
}
