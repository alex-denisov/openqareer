import type { AccountSnapshot } from '../coach/coachApi';
import type { ResumeStudioView } from '../resume/resumeTypes';

export interface CabinetIdentityInput {
  readonly account?: AccountSnapshot;
  readonly resume?: ResumeStudioView;
  readonly sessionDisplayName?: string | null;
  readonly username: string;
}

/**
 * How the cabinet addresses the candidate.
 *
 * A login is an account handle, not a person's name, and greeting someone with
 * `candidate.test` after they connected a real profile reads as if nothing was
 * imported at all (owner report, 2026-08-26; B172). An imported document
 * states the name the candidate publishes about themselves, so it outranks
 * the handle — and everything ranks below a name they entered by hand.
 */
export function cabinetDisplayName(input: CabinetIdentityInput): string {
  return (
    clean(input.account?.displayName) ??
    clean(input.sessionDisplayName) ??
    clean(input.resume?.draft?.candidate?.fullName) ??
    clean(input.resume?.projection?.master?.contact?.fullName) ??
    input.username
  );
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
