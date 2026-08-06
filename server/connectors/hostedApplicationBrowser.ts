import type { Browser, BrowserContext, Page } from 'playwright';
import { z } from 'zod';
import type {
  ConnectorExecutor,
  ConnectorReceipt,
  ConnectorRequest,
} from './connectorHarness';

const applicationPayloadSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().max(320),
  coverNote: z.string().max(5_000).optional(),
});

const providerReferenceSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

interface HostedApplicationOptions {
  connectorId: string;
  observedAt?: () => string;
  timeoutMs?: number;
}

export interface HostedApplicationBrowserSession {
  context: BrowserContext;
  page: Page;
  executor: HostedApplicationBrowserExecutor;
  close(): Promise<void>;
}

export class HostedApplicationBrowserExecutor implements ConnectorExecutor {
  readonly transport = 'browser_session' as const;
  readonly connectorId: string;
  private readonly observedAt: () => string;
  private readonly timeoutMs: number;

  private constructor(
    private readonly page: Page,
    options: HostedApplicationOptions,
  ) {
    this.connectorId = options.connectorId;
    this.observedAt = options.observedAt ?? (() => new Date().toISOString());
    this.timeoutMs = options.timeoutMs ?? 3_000;
  }

  static async create(
    browser: Browser,
    options: HostedApplicationOptions,
  ): Promise<HostedApplicationBrowserSession> {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const executor = new HostedApplicationBrowserExecutor(page, options);
    return {
      context,
      page,
      executor,
      close: async () => context.close(),
    };
  }

  async execute(request: ConnectorRequest): Promise<ConnectorReceipt> {
    if (request.action !== 'application') {
      return this.paused(request, 'action_not_supported', 'unexpected', 'unsupported-action');
    }
    const payload = applicationPayloadSchema.safeParse(request.payload);
    if (!payload.success) {
      return this.paused(request, 'application_payload_invalid', 'unexpected', 'invalid-payload');
    }
    if (await this.hasStoredSession()) {
      return this.paused(request, 'session_not_ephemeral', 'session_state', 'stored-session-present');
    }
    if (await this.hasChallenge()) {
      return this.paused(request, 'challenge_detected', 'challenge', 'challenge-heading');
    }

    const form = this.page.getByRole('form', { name: 'Job application' });
    const fullName = this.page.getByLabel('Full name', { exact: true });
    const email = this.page.getByLabel('Email', { exact: true });
    const coverNote = this.page.getByLabel('Cover note', { exact: true });
    const submit = this.page.getByRole('button', {
      name: 'Submit application',
      exact: true,
    });

    if (
      (await form.count()) !== 1 ||
      (await fullName.count()) !== 1 ||
      (await email.count()) !== 1 ||
      (await submit.count()) !== 1
    ) {
      return this.paused(request, 'unexpected_surface', 'unexpected', 'required-role-missing');
    }

    try {
      await fullName.fill(payload.data.fullName, { timeout: this.timeoutMs });
      await email.fill(payload.data.email, { timeout: this.timeoutMs });
      if (payload.data.coverNote && (await coverNote.count()) === 1) {
        await coverNote.fill(payload.data.coverNote, { timeout: this.timeoutMs });
      }
      await submit.click({ timeout: this.timeoutMs });
    } catch {
      return this.paused(
        request,
        'interaction_failed',
        'unexpected',
        'semantic-action-failed',
      );
    }

    const status = this.page.getByRole('status');
    try {
      await status.waitFor({ state: 'visible', timeout: this.timeoutMs });
    } catch {
      return this.paused(
        request,
        'confirmation_missing',
        'confirmation_missing',
        'status-not-visible',
      );
    }
    const providerReferenceValue = await status.getAttribute('data-application-id');
    if (!providerReferenceValue) {
      return this.paused(
        request,
        'confirmation_missing',
        'confirmation_missing',
        'provider-reference-missing',
      );
    }
    const providerReferenceResult = providerReferenceSchema.safeParse(
      providerReferenceValue,
    );
    if (!providerReferenceResult.success) {
      return this.paused(
        request,
        'confirmation_invalid',
        'confirmation_missing',
        'provider-reference-invalid',
      );
    }
    const providerReference = providerReferenceResult.data;

    return {
      connectorId: this.connectorId,
      transport: this.transport,
      action: request.action,
      status: 'completed',
      idempotencyKey: request.idempotencyKey,
      opportunityId: request.opportunityId,
      providerReference,
      evidence: {
        kind: 'dom_confirmation',
        observedAt: this.observedAt(),
      },
    };
  }

  private async hasChallenge(): Promise<boolean> {
    const challenge = this.page.getByRole('heading', {
      name: /captcha|verify you are human|security check/i,
    });
    return (await challenge.count()) > 0;
  }

  private async hasStoredSession(): Promise<boolean> {
    if ((await this.page.context().cookies()).length > 0) return true;
    try {
      return await this.page.evaluate(
        () => localStorage.length > 0 || sessionStorage.length > 0,
      );
    } catch {
      return false;
    }
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
        observedAt: this.observedAt(),
        surfaceFingerprint,
      },
    };
  }
}
