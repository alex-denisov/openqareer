import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRobokassaGateway, type RobokassaGatewayConfig } from './robokassaProtocol';

const config: RobokassaGatewayConfig = {
  merchantLogin: 'shop-test',
  password1: 'production-password-one',
  password2: 'production-password-two',
  testPassword1: 'test-password-one',
  testPassword2: 'test-password-two',
  hashAlgorithm: 'SHA256',
  testMode: true,
  recurringApproved: true,
  vat: 'none',
  paymentMethod: 'full_payment',
  taxSystem: 'usn_income',
  paymentMethods: ['BankCard', 'SBP', 'SberPay', 'TinkoffPay'],
};

function decodeJwt(token: string) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) throw new Error('invalid jwt');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown>,
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>,
    signingInput: `${header}.${payload}`,
    signature,
  };
}

describe('Robokassa invoice gateway', () => {
  it('creates a signed recurring invoice with the server price and fiscal itemization', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      invId: 731,
      url: 'https://auth.robokassa.ru/Merchant/Invoice/test-link',
      isSuccess: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const gateway = createRobokassaGateway(config, fetchImpl);

    await expect(gateway.createCheckout({
      invoiceId: 731,
      userId: 'user-1',
      userEmail: 'buyer@example.test',
      planId: 'basic',
      amountKopecks: 399_000,
      autoRenew: true,
    })).resolves.toEqual({
      invoiceId: 731,
      paymentUrl: 'https://auth.robokassa.ru/Merchant/Invoice/test-link',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://services.robokassa.ru/InvoiceServiceWebApi/api/CreateInvoice');
    expect(init.method).toBe('POST');
    const token = JSON.parse(String(init.body)) as string;
    const decoded = decodeJwt(token);
    expect(decoded.header).toEqual({ typ: 'JWT', alg: 'HS256' });
    expect(decoded.signature).toBe(createHmac('sha256', 'shop-test:test-password-one')
      .update(decoded.signingInput).digest('base64url'));
    expect(decoded.payload).toMatchObject({
      MerchantLogin: 'shop-test',
      InvId: 731,
      InvoiceType: 'OneTime',
      OutSum: 3990,
      InvoiceItems: [{ Name: 'Подписка Basic', Quantity: 1, Cost: 3990, Tax: 'none', PaymentMethod: 'full_payment', PaymentObject: 'service' }],
      Aliases: ['BankCard'],
      AdditionalParameters: {
        Email: 'buyer@example.test',
        IsTest: '1',
        Recurring: 'true',
        PaymentMethods: '["BankCard"]',
      },
      Sno: 'usn_income',
    });
  });

  it('rejects an Invoice API application error even when HTTP returned 200', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      isSuccess: false,
      message: 'bad invoice',
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const gateway = createRobokassaGateway(config, fetchImpl);

    await expect(gateway.createCheckout({
      invoiceId: 731,
      userId: 'user-1',
      userEmail: null,
      planId: 'basic',
      amountKopecks: 399_000,
      autoRenew: true,
    })).rejects.toThrow('robokassa_invoice_api_rejected');
  });

  it('creates a non-recurring invoice with the merchant payment methods when auto-renew is declined', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      invId: 733,
      url: 'https://auth.robokassa.ru/Merchant/Invoice/one-time-link',
      isSuccess: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const gateway = createRobokassaGateway({ ...config, recurringApproved: false }, fetchImpl);
    await gateway.createCheckout({
      invoiceId: 733,
      userId: 'user-1',
      userEmail: null,
      planId: 'basic',
      amountKopecks: 399_000,
      autoRenew: false,
    });
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit];
    const decoded = decodeJwt(JSON.parse(String(init.body)) as string);
    expect(decoded.payload).toMatchObject({
      Aliases: ['BankCard', 'SBP', 'SberPay', 'TinkoffPay'],
      AdditionalParameters: { PaymentMethods: '["BankCard","SBP","SberPay","TinkoffPay"]' },
    });
    expect(decoded.payload.AdditionalParameters).not.toHaveProperty('Recurring');
  });

  it('uses PreviousInvoiceID for a child charge and reports provider acceptance without granting payment', async () => {
    const fetchImpl = vi.fn(async () => new Response('OK732', { status: 200 })) as unknown as typeof fetch;
    const gateway = createRobokassaGateway(config, fetchImpl);
    await expect(gateway.createRecurringCharge({
      invoiceId: 732,
      previousInvoiceId: 731,
      userId: 'user-1',
      planId: 'basic',
      amountKopecks: 399_000,
    })).resolves.toEqual({ invoiceId: 732, accepted: true });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.robokassa.ru/Merchant/Recurring');
    const form = new URLSearchParams(String(init.body));
    expect(form.get('PreviousInvoiceID')).toBe('731');
    expect(form.get('InvoiceID')).toBe('732');
    expect(form.get('OutSum')).toBe('3990.00');
    const receipt = form.get('Receipt');
    expect(receipt).toContain('%7B');
    expect(form.get('SignatureValue')).toBe(createHash('sha256')
      .update(`shop-test:3990.00:732:${receipt}:test-password-one`)
      .digest('hex').toUpperCase());
  });

  it('reconciles a production recurring charge through the signed operation-state query', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      '<OperationStateResponse><Result><Code>0</Code></Result><State><Code>100</Code></State>'
        + '<Info><OutSum>3990.00</OutSum><PaymentMethod><Code>BankCard</Code></PaymentMethod></Info>'
        + '</OperationStateResponse>',
      { status: 200, headers: { 'content-type': 'application/xml' } },
    )) as unknown as typeof fetch;
    const gateway = createRobokassaGateway({ ...config, testMode: false }, fetchImpl);
    await expect(gateway.getRecurringChargeStatus({ invoiceId: 732, testMode: false })).resolves.toEqual({
      state: 'paid', amountKopecks: 399_000, paymentMethod: 'BankCard',
    });
    const [url] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain('OpStateExt?');
    expect(url.searchParams.get('Signature')).toBe(createHash('sha256')
      .update('shop-test:732:production-password-two').digest('hex').toUpperCase());
  });

  it('does not query the production-only operation-state endpoint for test payments', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const gateway = createRobokassaGateway(config, fetchImpl);
    await expect(gateway.getRecurringChargeStatus({ invoiceId: 732, testMode: true })).resolves.toMatchObject({
      state: 'unknown',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('verifies ResultURL with the invoice mode password and rejects amount or mode changes', () => {
    const gateway = createRobokassaGateway(config, vi.fn() as unknown as typeof fetch);
    const signatureValue = createHash('sha256')
      .update('3990.000000:731:test-password-two')
      .digest('hex').toUpperCase();
    expect(gateway.verifyResultSignature({
      invoiceId: 731,
      outSum: '3990.000000',
      signatureValue,
      testMode: true,
    })).toBe(true);
    expect(gateway.verifyResultSignature({
      invoiceId: 731,
      outSum: '3991.000000',
      signatureValue,
      testMode: true,
    })).toBe(false);
    expect(gateway.verifyResultSignature({
      invoiceId: 731,
      outSum: '3990.000000',
      signatureValue,
      testMode: false,
    })).toBe(false);
  });
});
