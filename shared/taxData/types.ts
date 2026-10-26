export type CountryCode =
  'DE' | 'CY' | 'RS' | 'AE' | 'GE' | 'RU' | 'AM' | 'KZ' | 'TR' | 'UZ' | 'BY' | 'ME' | 'GB';

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
  | {
      readonly kind: 'brackets';
      readonly bands: readonly TaxBand[];
      readonly source: TaxDataSource;
    }
  | {
      /** Tax on the part of the base above an exempt base, at the bands' marginal rates (Türkiye). */
      readonly kind: 'brackets-minus-exempt-base';
      readonly bands: readonly TaxBand[];
      readonly exemptAnnualBase: number;
      readonly source: TaxDataSource;
    }
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
  /** Where the ceiling is published when it is a separate act. */
  readonly capSource?: TaxDataSource;
  readonly annualCap?: number;
  readonly monthlyCap?: number;
  readonly monthlyFloor?: number;
  /** Pay up to this amount is not charged (a threshold, not a minimum base). */
  readonly annualExemptUpTo?: number;
  readonly monthlyExemptUpTo?: number;
  /** A fixed monthly amount picked by the monthly salary band instead of a rate (Armenia). */
  readonly monthlyFixedBands?: readonly { readonly upTo: number | null; readonly amount: number }[];
  readonly eligibility?: 'germany-childless' | 'georgia-pension-member';
}

export interface CountryTaxData {
  readonly code: CountryCode;
  readonly name: string;
  readonly currency: string;
  readonly taxYear: number;
  readonly incomeTax: IncomeTaxRule;
  readonly employeeContributions: readonly ContributionRule[];
  /** A surtax charged as a share of the income tax (Montenegro's municipal prirez). */
  readonly incomeTaxSurtax?: { readonly rate: number; readonly source: TaxDataSource };
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
