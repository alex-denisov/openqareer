export type PaidPlanId = 'basic' | 'pro' | 'max';

export interface BillingCheckoutInput {
  readonly invoiceId: number;
  readonly userId: string;
  readonly userEmail: string | null;
  readonly planId: PaidPlanId;
  readonly amountKopecks: number;
  readonly autoRenew: boolean;
}

export interface BillingCheckoutResult {
  readonly invoiceId: number;
  readonly paymentUrl: string;
}

export interface BillingRecurringChargeInput {
  readonly invoiceId: number;
  readonly previousInvoiceId: number;
  readonly userId: string;
  readonly planId: PaidPlanId;
  readonly amountKopecks: number;
}

export interface BillingRecurringChargeResult {
  readonly invoiceId: number;
  /** True means Robokassa created the child operation; it is not proof of payment. */
  readonly accepted: boolean;
}

export interface BillingRecurringChargeStatus {
  readonly state: 'paid' | 'failed' | 'pending' | 'unknown';
  readonly amountKopecks: number | null;
  readonly paymentMethod: string | null;
}

export interface RobokassaResultSignatureInput {
  readonly invoiceId: number;
  readonly outSum: string;
  readonly signatureValue: string;
  readonly testMode: boolean;
}

export interface RobokassaGateway {
  readonly testMode: boolean;
  createCheckout(input: BillingCheckoutInput): Promise<BillingCheckoutResult>;
  createRecurringCharge(input: BillingRecurringChargeInput): Promise<BillingRecurringChargeResult>;
  getRecurringChargeStatus(input: { invoiceId: number; testMode: boolean }): Promise<BillingRecurringChargeStatus>;
  verifyResultSignature(input: RobokassaResultSignatureInput): boolean;
}
