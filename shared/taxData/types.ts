export type CountryCode = 'DE' | 'CY' | 'RS' | 'AE' | 'GE' | 'RU';

export interface TaxDataSource {
  readonly title: string;
  readonly url: string;
  readonly retrievedAt: string;
  readonly dataYear: number;
}

export interface TaxBand {
  readonly upTo: number | null;
  readonly rate: number;
}

export type IncomeTaxRule =
  | { readonly kind: 'germany-2026'; readonly source: TaxDataSource }
  | { readonly kind: 'brackets'; readonly bands: readonly TaxBand[]; readonly source: TaxDataSource }
  | {
      readonly kind: 'flat-after-monthly-allowance';
      readonly rate: number;
      readonly monthlyAllowance: number;
      readonly source: TaxDataSource;
    }
  | { readonly kind: 'flat'; readonly rate: number; readonly source: TaxDataSource }
  | { readonly kind: 'none'; readonly source: TaxDataSource };

export interface ContributionRule {
  readonly name: string;
  readonly rate: number;
  readonly source: TaxDataSource;
  readonly annualCap?: number;
  readonly monthlyCap?: number;
  readonly monthlyFloor?: number;
  readonly eligibility?: 'germany-childless' | 'georgia-pension-member';
}

export interface CountryTaxData {
  readonly code: CountryCode;
  readonly name: string;
  readonly currency: string;
  readonly taxYear: number;
  readonly incomeTax: IncomeTaxRule;
  readonly employeeContributions: readonly ContributionRule[];
  readonly costOfLiving: {
    readonly monthlyRent: null;
    readonly monthlyPrivateHealthInsurance: null;
    readonly unavailableReason: string;
    readonly licensingSource: TaxDataSource;
  };
}

export interface SourcedMonthlyCost {
  readonly amount: number;
  readonly currency: string;
  readonly source: TaxDataSource;
}
