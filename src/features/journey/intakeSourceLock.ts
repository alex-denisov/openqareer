import type { ResumeSource } from '../workspace/workspaceStorage';
import type { SourceChoice } from './IntakeSourceStep';

/**
 * Below this the typed answer is a false start rather than a description of a
 * career, and the wizard already refuses to move on with less (`CareerIntake`).
 * Using the same number here keeps "enough to lock the source" and "enough to
 * continue" from disagreeing.
 */
export const MIN_TYPED_RESUME_LENGTH = 80;

export interface IntakeSourceCommitment {
  /** What the ingestion pipeline has parsed, if anything. */
  readonly ingestedSource?: ResumeSource;
  /** True once that document reached the candidate-scoped resume API. */
  readonly ingestedImported?: boolean;
  /** A platform whose profile is connected on this account. */
  readonly connectedPlatform?: 'hh' | 'linkedin';
  /** Length of the text typed into the wizard's own textarea. */
  readonly typedLength: number;
}

export interface IntakeSourceLockState {
  /** The source the career picture will be built from, once one is chosen. */
  readonly lockedTo?: SourceChoice;
  /** Why the other sources are closed, in the candidate's language. */
  readonly reason?: string;
}

const PLATFORM_NAME: Record<'hh' | 'linkedin', string> = {
  hh: 'hh.ru',
  linkedin: 'LinkedIn',
};

function platformOf(commitment: IntakeSourceCommitment): 'hh' | 'linkedin' | undefined {
  if (commitment.connectedPlatform) return commitment.connectedPlatform;
  if (commitment.ingestedSource === 'hh-pdf') return 'hh';
  if (commitment.ingestedSource === 'linkedin-pdf') return 'linkedin';
  return undefined;
}

/**
 * Which source the career picture is being built from, and why the rest are
 * closed.
 *
 * The wizard used to let a candidate stack a connected profile, a PDF and
 * typed text on top of one another. Each one is a different account of the
 * same career, and nothing downstream said which one wins — the owner named
 * this as the substantive problem, not a cosmetic one. One capture fixes the
 * source; the caller offers a way to release it deliberately.
 *
 * Precedence is by how much the candidate had to do to produce it: a connected
 * platform outranks a file they picked, which outranks text they typed.
 */
export function intakeSourceLock(
  commitment: IntakeSourceCommitment,
): IntakeSourceLockState {
  const platform = platformOf(commitment);
  if (platform) {
    return {
      lockedTo: 'profile-import',
      reason: `Профиль ${PLATFORM_NAME[platform]} уже подключён — карьерная картина собирается из него. Чтобы взять другой источник, сначала сбросьте этот.`,
    };
  }
  if (commitment.ingestedSource === 'pdf') {
    return {
      lockedTo: 'pdf',
      reason:
        'PDF уже прочитан — карьерная картина собирается из него. Чтобы взять другой источник, сначала сбросьте этот.',
    };
  }
  if (commitment.typedLength >= MIN_TYPED_RESUME_LENGTH) {
    return {
      lockedTo: 'text',
      reason:
        'Опыт уже описан текстом — карьерная картина собирается из него. Удалите текст или сбросьте источник, чтобы выбрать другой.',
    };
  }
  return {};
}
