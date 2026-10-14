import type {
  ConnectionCircleNumber,
  ConnectionCirclePath,
  ConnectionCirclePerson,
} from './vacancyLetterApi';

export interface LetterWorkplace {
  readonly id: string;
  readonly evidenceIds: readonly string[];
}

export interface PitchLetterText {
  readonly contactMessage?: string;
  readonly emailPitch: { readonly body: string };
}

export function letterBodyForCircle(
  circle: ConnectionCircleNumber,
  pitch: PitchLetterText,
): string {
  if (circle === 3) return pitch.emailPitch.body;
  return pitch.contactMessage?.trim() || pitch.emailPitch.body;
}

export function recipientForConnectionPath(
  path: Pick<ConnectionCirclePath, 'circle' | 'path' | 'recipient'>,
): { readonly name: string; readonly role?: string } | undefined {
  const person = personAddressedByConnectionPath(path);
  const name = person.fullName.trim();
  if (!name) return undefined;
  const role = person.roleTitle?.trim();
  return role ? { name, role } : { name };
}

export function personAddressedByConnectionPath(
  path: Pick<ConnectionCirclePath, 'circle' | 'path' | 'recipient'>,
): ConnectionCirclePerson {
  if (path.circle !== 2) return path.recipient;
  const pathBeforeRecipient =
    path.path.at(-1)?.id === path.recipient.id ? path.path.slice(0, -1) : path.path;
  return pathBeforeRecipient.at(-1) ?? path.recipient;
}

export function excludedEvidenceIdsForWorkplaces(
  workplaces: readonly LetterWorkplace[],
  selectedWorkplaceIds: readonly string[],
): string[] {
  const selected = new Set(selectedWorkplaceIds);
  const includedEvidence = new Set(
    workplaces
      .filter((workplace) => selected.has(workplace.id))
      .flatMap((workplace) => workplace.evidenceIds),
  );
  const excludedEvidence = new Set(
    workplaces
      .filter((workplace) => !selected.has(workplace.id))
      .flatMap((workplace) => workplace.evidenceIds),
  );
  return Array.from(excludedEvidence).filter((evidenceId) => !includedEvidence.has(evidenceId));
}
