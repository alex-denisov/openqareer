import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BILLING_PLANS } from './billingPlans';
import type { BillingInvoice, ReserveCheckoutResult } from './sqliteBillingRepository';
import type { AuthPrincipal } from '../auth/authTypes';
import type { RouteDeps } from '../routes/deps';
import {
  authenticateSession,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from '../routes/helpers';

const checkoutSchema = z
  .object({
    planId: z.enum(['basic', 'pro', 'max']),
    autoRenew: z.boolean(),
  })
  .strict();
const cursorSchema = z
  .object({
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const invoiceParamsSchema = z.object({ invoiceId: z.coerce.number().int().positive() }).strict();

function billingPrincipal(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal || principal.role !== 'candidate' || !principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  if (deps.config.emailVerificationRequired === true && principal.emailVerified === false) {
    sendError(reply, request, 403, 'email_unverified', 'Подтвердите email перед оплатой.', false);
    return null;
  }
  return principal;
}

function checkoutView(invoice: BillingInvoice) {
  return {
    invoiceId: invoice.invoiceId,
    planId: invoice.planId,
    amountKopecks: invoice.amountKopecks,
    currency: 'RUB' as const,
    status: invoice.status,
    autoRenew: invoice.autoRenewOptIn,
    paymentUrl: invoice.paymentUrl,
    createdAt: invoice.createdAt,
  };
}

function checkoutResourceUrl(invoiceId: number): string {
  return `/api/v1/candidate/billing/checkouts/${invoiceId}`;
}

function checkoutConflict(
  repository: NonNullable<RouteDeps['billingRepository']>,
  userId: string,
  idempotencyKey: string,
  planId: (typeof BILLING_PLANS)[keyof typeof BILLING_PLANS]['id'],
): { code: string; message: string; retryable: boolean } | null {
  const idempotentReplay = repository.hasCheckoutForIdempotencyKey(userId, idempotencyKey);
  if (idempotentReplay) return null;
  if (repository.hasUnresolvedPayment(userId)) {
    return {
      code: 'billing_payment_processing',
      message: 'Дождитесь подтверждения текущего платежа.',
      retryable: true,
    };
  }
  const subscription = repository.getSubscription(userId, new Date().toISOString());
  if (!subscription) return null;
  if (subscription.status === 'past_due' && subscription.planId === planId) return null;
  const planRank = { basic: 0, pro: 1, max: 2 } as const;
  return planRank[planId] <= planRank[subscription.planId]
    ? {
        code: 'billing_plan_not_upgrade',
        message: 'Вы уже используете этот тариф или выше.',
        retryable: false,
      }
    : null;
}

async function createReservedCheckout(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  principal: AuthPrincipal,
  plan: (typeof BILLING_PLANS)[keyof typeof BILLING_PLANS],
  invoice: BillingInvoice,
) {
  const repository = deps.billingRepository;
  if (!repository || !deps.robokassaGateway) {
    return sendError(
      reply,
      request,
      503,
      'billing_unavailable',
      'Оплата временно недоступна.',
      true,
    );
  }
  try {
    const saved = await saveProviderCheckout(deps, repository, principal, plan, invoice);
    return reply
      .code(201)
      .header('Location', checkoutResourceUrl(saved.invoiceId))
      .send({ data: checkoutView(saved), meta: { requestId: request.id } });
  } catch {
    repository.markCheckoutFailed(invoice.invoiceId, new Date().toISOString());
    request.log.error({ invoiceId: invoice.invoiceId }, 'billing_checkout_failed');
    return sendError(
      reply,
      request,
      503,
      'billing_checkout_failed',
      'Не удалось создать ссылку на оплату.',
      true,
    );
  }
}

async function saveProviderCheckout(
  deps: RouteDeps,
  repository: NonNullable<RouteDeps['billingRepository']>,
  principal: AuthPrincipal,
  plan: (typeof BILLING_PLANS)[keyof typeof BILLING_PLANS],
  invoice: BillingInvoice,
): Promise<BillingInvoice> {
  const gateway = deps.robokassaGateway;
  if (!gateway) throw new Error('robokassa_not_configured');
  const created = await gateway.createCheckout({
    invoiceId: invoice.invoiceId,
    userId: principal.userId,
    userEmail:
      principal.emailVerified === true
        ? (deps.authService.getUser?.(principal.userId)?.email ?? null)
        : null,
    planId: plan.id,
    amountKopecks: plan.amountKopecks,
    autoRenew: invoice.autoRenewOptIn,
  });
  if (created.invoiceId !== invoice.invoiceId || !isRobokassaPaymentUrl(created.paymentUrl)) {
    throw new Error('robokassa_checkout_response_invalid');
  }
  repository.setCheckoutUrl(created.invoiceId, created.paymentUrl, new Date().toISOString());
  const saved = repository.getInvoice(created.invoiceId);
  if (!saved) throw new Error('billing_invoice_missing_after_checkout');
  return saved;
}

function handleGetBillingSummary(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = billingPrincipal(deps, request, reply);
  if (!principal) return;
  if (!deps.billingRepository) {
    return sendError(
      reply,
      request,
      503,
      'billing_unavailable',
      'Управление тарифом временно недоступно.',
      true,
    );
  }
  const subscription = deps.billingRepository.getSubscription(
    principal.userId,
    new Date().toISOString(),
  );
  const currentPlan = deps.billingRepository.getEffectivePlan(principal.userId, new Date().toISOString());
  return reply.send({
    data: {
      currentPlan,
      subscription: subscription
        ? {
            status: subscription.status,
            currentPeriodEndsAt: subscription.currentPeriodEndsAt,
            nextChargeAt: subscription.nextChargeAt,
            autoRenew: subscription.autoRenew,
          }
        : null,
      plans: Object.values(BILLING_PLANS),
    },
    meta: { requestId: request.id },
  });
}

function handleGetCheckout(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = billingPrincipal(deps, request, reply);
  if (!principal) return;
  if (!deps.billingRepository) {
    return sendError(
      reply,
      request,
      503,
      'billing_unavailable',
      'Состояние оплаты временно недоступно.',
      true,
    );
  }
  const parsed = invoiceParamsSchema.safeParse(request.params);
  if (!parsed.success)
    return sendError(
      reply,
      request,
      400,
      'billing_invoice_id_invalid',
      'Проверьте номер заказа.',
      false,
    );
  const invoice = deps.billingRepository.getInvoiceForUser(principal.userId, parsed.data.invoiceId);
  if (!invoice)
    return sendError(reply, request, 404, 'billing_checkout_not_found', 'Заказ не найден.', false);
  return reply.send({ data: checkoutView(invoice), meta: { requestId: request.id } });
}

function parseCheckoutIdempotencyKey(request: FastifyRequest, reply: FastifyReply): string | null {
  const value = request.headers['idempotency-key'];
  if (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[\w:.-]+$/u.test(value)
  ) {
    return value;
  }
  sendError(
    reply,
    request,
    400,
    'idempotency_key_required',
    'Передайте корректный Idempotency-Key.',
    false,
  );
  return null;
}

function parseCheckoutBody(request: FastifyRequest, reply: FastifyReply) {
  const parsed = checkoutSchema.safeParse(request.body);
  if (parsed.success) return parsed.data;
  sendError(
    reply,
    request,
    400,
    'billing_checkout_invalid',
    'Выберите доступный платный тариф.',
    false,
  );
  return null;
}

async function handleCreateCheckout(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const principal = billingPrincipal(deps, request, reply);
  if (!principal) return;
  const idempotencyKey = parseCheckoutIdempotencyKey(request, reply);
  if (!idempotencyKey) return;
  const checkout = parseCheckoutBody(request, reply);
  if (!checkout) return;
  const repository = deps.billingRepository;
  const gateway = deps.robokassaGateway;
  if (!repository || !gateway) {
    return sendError(
      reply,
      request,
      503,
      'billing_unavailable',
      'Оплата временно недоступна.',
      true,
    );
  }
  const plan = BILLING_PLANS[checkout.planId];
  const conflict = checkoutConflict(repository, principal.userId, idempotencyKey, plan.id);
  if (conflict)
    return sendError(reply, request, 409, conflict.code, conflict.message, conflict.retryable);
  const reservation = repository.reserveCheckout({
    userId: principal.userId,
    planId: plan.id,
    amountKopecks: plan.amountKopecks,
    autoRenewOptIn: checkout.autoRenew,
    idempotencyKey,
    testMode: gateway.testMode,
    now: new Date().toISOString(),
  });
  return respondToCheckoutReservation(deps, request, reply, principal, plan, reservation);
}

async function respondToCheckoutReservation(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  principal: AuthPrincipal,
  plan: (typeof BILLING_PLANS)[keyof typeof BILLING_PLANS],
  reservation: ReserveCheckoutResult,
) {
  if (reservation.kind === 'conflict') {
    return sendError(
      reply,
      request,
      409,
      'idempotency_key_reused',
      'Этот ключ уже использован для другого тарифа.',
      false,
    );
  }
  if (reservation.kind === 'in_progress') {
    return sendError(
      reply,
      request,
      409,
      'checkout_in_progress',
      'Создание ссылки на оплату ещё выполняется.',
      true,
    );
  }
  if (reservation.kind === 'existing') {
    if (reservation.invoice.status === 'failed') {
      return sendError(
        reply,
        request,
        409,
        'checkout_failed_retry_new_key',
        'Оплата не началась. Создайте новый заказ.',
        false,
      );
    }
    return reply
      .code(200)
      .header('Location', checkoutResourceUrl(reservation.invoice.invoiceId))
      .send({ data: checkoutView(reservation.invoice), meta: { requestId: request.id } });
  }

  return createReservedCheckout(deps, request, reply, principal, plan, reservation.invoice);
}

function handleListReceipts(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = billingPrincipal(deps, request, reply);
  if (!principal) return;
  if (!deps.billingRepository) {
    return sendError(
      reply,
      request,
      503,
      'billing_unavailable',
      'История платежей временно недоступна.',
      true,
    );
  }
  const parsed = cursorSchema.safeParse(request.query);
  if (!parsed.success)
    return sendError(
      reply,
      request,
      400,
      'billing_receipts_query_invalid',
      'Проверьте параметры списка чеков.',
      false,
    );
  const rows = deps.billingRepository.listReceipts(principal.userId, parsed.data);
  const last = rows.at(-1);
  return reply.send({
    data: rows.map((invoice) => ({
      invoiceId: invoice.invoiceId,
      planId: invoice.planId,
      amountKopecks: invoice.amountKopecks,
      currency: 'RUB' as const,
      paidAt: invoice.paidAt,
      paymentMethod: invoice.paymentMethod,
      receiptUrl: invoice.receiptUrl,
      receiptStatus: invoice.receiptStatus,
      fiscalDocumentNumber: invoice.fiscalDocumentNumber,
      fiscalDate: invoice.fiscalDate,
    })),
    meta: {
      requestId: request.id,
      nextCursor: rows.length === parsed.data.limit && last ? String(last.invoiceId) : null,
    },
  });
}

function handleCancelRenewal(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const principal = billingPrincipal(deps, request, reply);
  if (!principal) return;
  if (!deps.billingRepository) {
    return sendError(
      reply,
      request,
      503,
      'billing_unavailable',
      'Управление подпиской временно недоступно.',
      true,
    );
  }
  const subscription = deps.billingRepository.cancelRenewal(
    principal.userId,
    new Date().toISOString(),
  );
  if (!subscription) {
    return sendError(
      reply,
      request,
      404,
      'billing_subscription_not_found',
      'Активная подписка не найдена.',
      false,
    );
  }
  return reply.send({
    data: {
      planId: subscription.planId,
      status: subscription.status,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      nextChargeAt: null,
      autoRenew: false,
      cancellationEventId: subscription.cancellationEventId,
    },
    meta: { requestId: request.id },
  });
}

async function handleRobokassaResult(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = callbackParams(request);
  const invoiceId = parsePositiveInvoiceId(params.get('InvId') ?? params.get('InvID'));
  const outSum = params.get('OutSum');
  const signatureValue = params.get('SignatureValue');
  if (invoiceId === null || !outSum || !signatureValue) {
    return callbackText(reply, 400, 'bad request');
  }
  if (!deps.billingRepository || !deps.robokassaGateway) {
    return callbackText(reply, 503, 'not configured');
  }
  const invoice = deps.billingRepository.getInvoice(invoiceId);
  if (!invoice) return callbackText(reply, 404, 'unknown invoice');
  if (
    !deps.robokassaGateway.verifyResultSignature({
      invoiceId,
      outSum,
      signatureValue,
      testMode: invoice.testMode,
    })
  ) {
    request.log.warn({ invoiceId }, 'billing_result_bad_signature');
    return callbackText(reply, 403, 'bad signature');
  }
  const amountKopecks = parseOutSumToKopecks(outSum);
  if (amountKopecks !== invoice.amountKopecks) {
    request.log.warn({ invoiceId }, 'billing_result_amount_mismatch');
    return callbackText(reply, 409, 'amount mismatch');
  }
  const result = deps.billingRepository.applySuccessfulInvoice({
    invoiceId,
    paymentMethod: null,
    paidAt: new Date().toISOString(),
  });
  if (result === 'not_pending') return callbackText(reply, 409, 'invoice is not payable');
  if (result === 'not_found') return callbackText(reply, 404, 'unknown invoice');
  request.log.info({ invoiceId, result }, 'billing_result_applied');
  return callbackText(reply, 200, `OK${invoiceId}`);
}

function callbackParams(request: FastifyRequest): URLSearchParams {
  const query = request.query;
  const params = new URLSearchParams();
  if (typeof query === 'object' && query !== null) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string' || typeof value === 'number') params.set(key, String(value));
    }
  }
  const body = request.body;
  if (body instanceof URLSearchParams) {
    for (const [key, value] of body.entries()) params.set(key, value);
  } else if (typeof body === 'string') {
    for (const [key, value] of new URLSearchParams(body).entries()) params.set(key, value);
  } else if (typeof body === 'object' && body !== null) {
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string' || typeof value === 'number') params.set(key, String(value));
    }
  }
  return params;
}

function parsePositiveInvoiceId(value: string | null): number | null {
  if (!value || !/^\d{1,12}$/u.test(value)) return null;
  const invoiceId = Number(value);
  return Number.isSafeInteger(invoiceId) && invoiceId > 0 ? invoiceId : null;
}

function parseOutSumToKopecks(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/u.test(normalized)) return null;
  const [whole = '', fraction = ''] = normalized.split('.');
  const micros = fraction.padEnd(6, '0');
  if (micros.slice(2) !== '0000') return null;
  const result = Number(whole) * 100 + Number(micros.slice(0, 2));
  return Number.isSafeInteger(result) ? result : null;
}

function callbackText(reply: FastifyReply, statusCode: number, body: string): FastifyReply {
  return reply.code(statusCode).type('text/plain; charset=utf-8').send(body);
}

function isRobokassaPaymentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'auth.robokassa.ru';
  } catch {
    return false;
  }
}

function handleGetProTrial(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = billingPrincipal(deps, request, reply);
  if (!principal) return;
  if (!deps.billingRepository) return sendError(reply, request, 503, 'billing_unavailable', 'Пробный Pro временно недоступен. Попробуйте позже.', true);
  reply.header('Cache-Control', 'no-store');
  return reply.send({ data: deps.billingRepository.getProTrial(principal.userId, new Date().toISOString()), meta: { requestId: request.id } });
}

function handleActivateProTrial(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const principal = billingPrincipal(deps, request, reply);
  if (!principal) return;
  if (!z.object({}).strict().safeParse(request.body ?? {}).success) {
    return sendError(reply, request, 400, 'invalid_request', 'Для включения пробного Pro дополнительные данные не нужны.', false);
  }
  if (!deps.billingRepository) return sendError(reply, request, 503, 'billing_unavailable', 'Пробный Pro временно недоступен. Попробуйте позже.', true);
  const result = deps.billingRepository.activateProTrial(principal.userId, new Date().toISOString());
  reply.header('Cache-Control', 'no-store');
  if (!result.activated) return sendError(reply, request, 409, 'pro_trial_unavailable', result.trial.status === 'unavailable' ? 'У вас уже действует платный тариф.' : 'Пробный Pro можно включить только один раз.', false);
  return reply.code(201).send({ data: result.trial, meta: { requestId: request.id } });
}

export function registerBillingRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/billing/trial', withDeps(deps, handleGetProTrial));
  app.post('/api/v1/candidate/billing/trial', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, withDeps(deps, handleActivateProTrial));
  app.get('/api/v1/candidate/billing', withDeps(deps, handleGetBillingSummary));
  app.get('/api/v1/candidate/billing/checkouts/:invoiceId', withDeps(deps, handleGetCheckout));
  app.post(
    '/api/v1/candidate/billing/checkouts',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    withDeps(deps, handleCreateCheckout),
  );
  app.get('/api/v1/candidate/billing/receipts', withDeps(deps, handleListReceipts));
  app.post(
    '/api/v1/candidate/billing/subscription/cancel-renewal',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    withDeps(deps, handleCancelRenewal),
  );
  app.post('/api/v1/billing/robokassa/result', withDeps(deps, handleRobokassaResult));
  app.get('/api/v1/billing/robokassa/result', withDeps(deps, handleRobokassaResult));
}
