import type { MobilityResidenceDocument } from './types';

/** Documents that grant a residence and work right in their country by themselves. */
const RESIDENCE_RIGHT_KINDS: ReadonlySet<MobilityResidenceDocument['kind']> = new Set([
  'residence_permit',
  'work_permit',
]);

const DOCUMENT_LABELS: Readonly<Record<MobilityResidenceDocument['kind'], string>> = {
  residence_permit: 'ВНЖ',
  work_permit: 'разрешение на работу',
  work_visa: 'рабочая виза',
  study_visa: 'учебная виза',
  visa: 'виза',
  other: 'документ',
};

const RENEWAL_WINDOW_MONTHS = 6;

export interface ResidenceRight {
  readonly valid: boolean;
  readonly reason: string;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

function addMonths(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function describe(document: MobilityResidenceDocument, asOf: string | undefined): ResidenceRight {
  const label = DOCUMENT_LABELS[document.kind];
  const { expiresAt } = document;
  if (!expiresAt) return { valid: true, reason: `Действует ${label}, срок не указан.` };
  if (asOf && expiresAt < asOf) {
    const verb = document.kind === 'residence_permit' ? 'истёк' : 'истекло';
    return { valid: false, reason: `${capitalize(label)} ${verb} ${formatDate(expiresAt)}.` };
  }
  const soon = asOf !== undefined && expiresAt < addMonths(asOf, RENEWAL_WINDOW_MONTHS);
  const renewal = soon ? ', срок скоро нужно продлить' : '';
  return { valid: true, reason: `Действует ${label} до ${formatDate(expiresAt)}${renewal}.` };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The residence right a candidate's own documents give in one country: a valid
 * permit wins over an expired one, the latest expiry wins among valid ones.
 * Visas are left to the scenario rules.
 */
export function residenceRightIn(
  countryCode: string,
  documents: readonly MobilityResidenceDocument[] | undefined,
  asOf: string | undefined,
): ResidenceRight | null {
  const rights = (documents ?? [])
    .filter(
      (document) =>
        document.countryCode.toUpperCase() === countryCode &&
        RESIDENCE_RIGHT_KINDS.has(document.kind),
    )
    .map((document) => ({ document, right: describe(document, asOf) }));
  if (!rights.length) return null;
  const expiry = (document: MobilityResidenceDocument) => document.expiresAt ?? '9999-12-31';
  const best = [...rights].sort(
    (left, right) =>
      Number(right.right.valid) - Number(left.right.valid) ||
      expiry(right.document).localeCompare(expiry(left.document)),
  )[0];
  return best ? best.right : null;
}
