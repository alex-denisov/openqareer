import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  BillingCheckoutInput,
  BillingRecurringChargeInput,
  BillingRecurringChargeStatus,
  RobokassaGateway,
} from './robokassaGateway';

export type RobokassaHashAlgorithm = 'MD5' | 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512';
export type RobokassaVat =
  | 'none' | 'vat0' | 'vat5' | 'vat7' | 'vat10' | 'vat20' | 'vat22'
  | 'vat105' | 'vat107' | 'vat110' | 'vat120' | 'vat122';
export type RobokassaTaxSystem = 'osn' | 'usn_income' | 'usn_income_outcome' | 'esn' | 'patent';
export type RobokassaPaymentMethod = 'full_payment' | 'full_prepayment' | 'advance';

export interface RobokassaGatewayConfig {
  readonly merchantLogin: string;
  readonly password1: string;
  readonly password2: string;
  readonly testPassword1?: string;
  readonly testPassword2?: string;
  readonly hashAlgorithm: RobokassaHashAlgorithm;
  readonly testMode: boolean;
  readonly recurringApproved: boolean;
  readonly vat: RobokassaVat;
  readonly paymentMethod: RobokassaPaymentMethod;
  readonly taxSystem?: RobokassaTaxSystem;
  readonly paymentMethods: readonly string[];
  readonly requestTimeoutMs?: number;
}

export function createRobokassaGateway(
  config: RobokassaGatewayConfig,
  fetchImpl: typeof fetch = fetch,
): RobokassaGateway {
  return {
    testMode: config.testMode,
    createCheckout: (input) => createCheckout(config, fetchImpl, input),
    createRecurringCharge: (input) => createRecurringCharge(config, fetchImpl, input),
    getRecurringChargeStatus: (input) => getRecurringChargeStatus(config, fetchImpl, input),
    verifyResultSignature: (input) => verifyResultSignature(config, input),
  };
}

const INVOICE_API_URL = 'https://services.robokassa.ru/InvoiceServiceWebApi/api/CreateInvoice';
const RECURRING_URL = 'https://auth.robokassa.ru/Merchant/Recurring';
const OP_STATE_URL = 'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt';
const HASH_NAMES: Readonly<Record<RobokassaHashAlgorithm, string>> = {
  MD5: 'md5', SHA1: 'sha1', SHA256: 'sha256', SHA384: 'sha384', SHA512: 'sha512',
};
const JWT_ALGORITHMS: Readonly<Record<RobokassaHashAlgorithm, string>> = {
  MD5: 'MD5', SHA1: 'HS1', SHA256: 'HS256', SHA384: 'HS384', SHA512: 'HS512',
};

interface RobokassaInvoiceResponse {
  readonly invId?: unknown;
  readonly url?: unknown;
  readonly isSuccess?: unknown;
}

async function createCheckout(
  config: RobokassaGatewayConfig,
  fetchImpl: typeof fetch,
  input: BillingCheckoutInput,
): Promise<{ invoiceId: number; paymentUrl: string }> {
  if (input.autoRenew && !config.recurringApproved) throw new Error('robokassa_recurring_not_approved');
  const paymentMethods = input.autoRenew ? ['BankCard'] : [...config.paymentMethods];
  const payload = {
    MerchantLogin: config.merchantLogin,
    InvId: input.invoiceId,
    InvoiceType: 'OneTime',
    Culture: 'ru',
    OutSum: input.amountKopecks / 100,
    Description: `Оплата тарифа ${planLabel(input.planId)}`,
    InvoiceItems: [{
      Name: `Подписка ${planLabel(input.planId)}`,
      Quantity: 1,
      Cost: input.amountKopecks / 100,
      Tax: config.vat,
      PaymentMethod: config.paymentMethod,
      PaymentObject: 'service',
    }],
    Aliases: paymentMethods,
    AdditionalParameters: {
      ...(input.userEmail ? { Email: input.userEmail } : {}),
      ...(config.testMode ? { IsTest: '1' } : {}),
      ...(input.autoRenew ? { Recurring: 'true' } : {}),
      PaymentMethods: JSON.stringify(paymentMethods),
    },
    ...(config.taxSystem ? { Sno: config.taxSystem } : {}),
  };
  const response = await fetchImpl(INVOICE_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createInvoiceJwt(config, payload)),
    signal: AbortSignal.timeout(config.requestTimeoutMs ?? 10_000),
  });
  const responseBody = await readJsonResponse(response);
  if (!response.ok || responseBody.isSuccess !== true) {
    throw new Error('robokassa_invoice_api_rejected');
  }
  const invoiceId = Number(responseBody.invId);
  const paymentUrl = typeof responseBody.url === 'string' ? responseBody.url : '';
  if (invoiceId !== input.invoiceId || !isRobokassaPaymentUrl(paymentUrl)) {
    throw new Error('robokassa_invoice_api_response_invalid');
  }
  return { invoiceId, paymentUrl };
}

async function createRecurringCharge(
  config: RobokassaGatewayConfig,
  fetchImpl: typeof fetch,
  input: BillingRecurringChargeInput,
): Promise<{ invoiceId: number; accepted: boolean }> {
  if (!config.recurringApproved) throw new Error('robokassa_recurring_not_approved');
  const outSum = (input.amountKopecks / 100).toFixed(2);
  const description = `Продление тарифа ${planLabel(input.planId)}`;
  const receipt = encodeReceipt(JSON.stringify({
    ...(config.taxSystem ? { sno: config.taxSystem } : {}),
    items: [{
      name: `Подписка ${planLabel(input.planId)}`,
      quantity: 1,
      sum: Number(outSum),
      payment_method: config.paymentMethod,
      payment_object: 'service',
      tax: config.vat,
    }],
  }));
  // PreviousInvoiceID selects the original recurring parent and is intentionally
  // omitted from the signature, as the current Robokassa protocol requires.
  const signatureValue = hash([
    config.merchantLogin,
    outSum,
    String(input.invoiceId),
    receipt,
    selectedPassword1(config),
  ].join(':'), config.hashAlgorithm);
  const body = new URLSearchParams({
    MerchantLogin: config.merchantLogin,
    OutSum: outSum,
    InvoiceID: String(input.invoiceId),
    PreviousInvoiceID: String(input.previousInvoiceId),
    Description: description,
    Receipt: receipt,
    SignatureValue: signatureValue,
  });
  const response = await fetchImpl(RECURRING_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(config.requestTimeoutMs ?? 10_000),
  });
  const acknowledgement = (await response.text()).trim();
  if (!response.ok || acknowledgement !== `OK${input.invoiceId}`) {
    throw new Error('robokassa_recurring_charge_rejected');
  }
  return { invoiceId: input.invoiceId, accepted: true };
}

async function getRecurringChargeStatus(
  config: RobokassaGatewayConfig,
  fetchImpl: typeof fetch,
  input: { invoiceId: number; testMode: boolean },
): Promise<BillingRecurringChargeStatus> {
  if (input.testMode) return { state: 'unknown', amountKopecks: null, paymentMethod: null };
  const url = new URL(OP_STATE_URL);
  url.searchParams.set('MerchantLogin', config.merchantLogin);
  url.searchParams.set('InvoiceID', String(input.invoiceId));
  url.searchParams.set('Signature', hash(
    `${config.merchantLogin}:${input.invoiceId}:${selectedPassword2(config, false)}`,
    config.hashAlgorithm,
  ));
  const response = await fetchImpl(url, {
    method: 'GET',
    signal: AbortSignal.timeout(config.requestTimeoutMs ?? 10_000),
  });
  if (!response.ok) return { state: 'unknown', amountKopecks: null, paymentMethod: null };
  const xml = await response.text();
  if (xml.length > 65_536 || /<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    return { state: 'unknown', amountKopecks: null, paymentMethod: null };
  }
  const result = xmlBlock(xml, 'Result');
  const stateCode = Number(xmlValue(xmlBlock(xml, 'State') ?? '', 'Code'));
  if (!result || Number(xmlValue(result, 'Code')) !== 0) {
    return { state: 'unknown', amountKopecks: null, paymentMethod: null };
  }
  const info = xmlBlock(xml, 'Info') ?? '';
  const amountKopecks = parseProviderAmount(xmlValue(info, 'OutSum'));
  const paymentMethod = xmlValue(xmlBlock(info, 'PaymentMethod') ?? '', 'Code');
  const status = stateCode === 100 ? 'paid'
    : stateCode === 10 || stateCode === 60 ? 'failed'
      : stateCode === 5 || stateCode === 20 || stateCode === 50 || stateCode === 80 ? 'pending'
        : 'unknown';
  return { state: status, amountKopecks, paymentMethod: paymentMethod?.slice(0, 80) ?? null };
}

function xmlBlock(xml: string, name: string): string | null {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'iu').exec(xml)?.[1] ?? null;
}

function xmlValue(xml: string, name: string): string | null {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)<\\/${name}>`, 'iu').exec(xml)?.[1]?.trim() ?? null;
}

function parseProviderAmount(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [whole = '', fraction = ''] = normalized.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function verifyResultSignature(
  config: RobokassaGatewayConfig,
  input: { invoiceId: number; outSum: string; signatureValue: string; testMode: boolean },
): boolean {
  const expected = hash(
    `${input.outSum}:${input.invoiceId}:${selectedPassword2(config, input.testMode)}`,
    config.hashAlgorithm,
  );
  const left = Buffer.from(expected.toUpperCase(), 'utf8');
  const right = Buffer.from(input.signatureValue.trim().toUpperCase(), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function createInvoiceJwt(config: RobokassaGatewayConfig, payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: JWT_ALGORITHMS[config.hashAlgorithm] }))
    .toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const signature = createHmac(
    HASH_NAMES[config.hashAlgorithm],
    `${config.merchantLogin}:${selectedPassword1(config)}`,
  )
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

function selectedPassword1(config: RobokassaGatewayConfig): string {
  if (!config.testMode) return config.password1;
  if (!config.testPassword1) throw new Error('robokassa_test_password1_missing');
  return config.testPassword1;
}

function selectedPassword2(config: RobokassaGatewayConfig, testMode: boolean): string {
  if (!testMode) return config.password2;
  if (!config.testPassword2) throw new Error('robokassa_test_password2_missing');
  return config.testPassword2;
}

function hash(value: string, algorithm: RobokassaHashAlgorithm): string {
  return createHash(HASH_NAMES[algorithm]).update(value, 'utf8').digest('hex').toUpperCase();
}

function encodeReceipt(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function planLabel(planId: BillingCheckoutInput['planId']): string {
  return planId === 'basic' ? 'Basic' : planId === 'pro' ? 'Pro' : 'Max';
}

function isRobokassaPaymentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'auth.robokassa.ru';
  } catch {
    return false;
  }
}

async function readJsonResponse(response: Response): Promise<RobokassaInvoiceResponse> {
  const text = await response.text();
  if (text.length > 16_384) throw new Error('robokassa_invoice_api_response_too_large');
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) throw new Error('not-object');
    return value as RobokassaInvoiceResponse;
  } catch {
    throw new Error('robokassa_invoice_api_invalid_json');
  }
}
