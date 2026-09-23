import type { CandidateRegion } from '../workspace/candidateRegions';
import type { ResumeSource, WorkspaceInput } from '../workspace/workspaceStorage';
import type { OnboardingFormat } from './OnboardingGeoStep';
import type { OnboardingTalkValues } from './OnboardingTalkStep';
import type { SourceChoice } from './IntakeSourceStep';
import type { IngestedResume } from './useResumeIngestion';

export interface OnboardingWorkspaceInputState {
  readonly sourceChoice: SourceChoice;
  readonly ingested?: IngestedResume;
  readonly talk: OnboardingTalkValues;
  /** The role the candidate picked on step 4, if any. */
  readonly selectedRoleTitle?: string;
  readonly regions: readonly CandidateRegion[];
  readonly format: OnboardingFormat;
  /** Keyed by review-row id — what "Исправить" produced (step 3). */
  readonly reviewOverrides: Readonly<Record<string, string>>;
  readonly linkedinUrl: string;
  readonly hhUrl: string;
}

function talkSummary(talk: OnboardingTalkValues): string {
  return [
    talk.tasks && `Что делал(а): ${talk.tasks}`,
    talk.change && `Что хочет изменить: ${talk.change}`,
    talk.successMeasure && `Результат через год: ${talk.successMeasure}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The wizard's whole state, folded into one `WorkspaceInput` the same way
 * `createWorkspace` expects it. `careerGoal` is deliberately left unset: the
 * mockup's step 1 is the source chooser, not a goal question — the "Хочу
 * найти работу" / "Не понимаю, какая роль" step from the old wizard has no
 * screen in the approved design (onboarding.html) and is not asked here.
 */
export function buildOnboardingWorkspaceInput(
  state: OnboardingWorkspaceInputState,
): WorkspaceInput {
  const { ingested, sourceChoice } = state;
  const resumeSource: ResumeSource =
    sourceChoice === 'none' ? 'text' : (ingested?.source ?? 'text');
  const corrections = Object.values(state.reviewOverrides).filter(Boolean);
  const constraints = [state.format, ...corrections].filter(Boolean).join('. ');

  return {
    careerGoal: undefined,
    resumeText: ingested?.text ?? '',
    resumeSource,
    resumeFileName: ingested?.file?.name,
    resumePageCount: ingested?.file?.pages,
    // The role chosen on step 4 is a deliberate decision and outranks the
    // parser's own guess; the guess only stands in until one is made.
    targetDirection: state.selectedRoleTitle ?? ingested?.parsed.targetRole ?? '',
    regions: state.regions,
    currentSituation: ingested ? '' : talkSummary(state.talk),
    constraints,
    // The old wizard's "темп поиска" question has no equivalent step in the
    // approved mockup; "active" was already its default, so nothing the
    // candidate used to control is silently changed here — the question
    // itself is simply not asked anymore, by design (onboarding.html).
    urgency: 'active',
    linkedinUrl: state.linkedinUrl.trim() || undefined,
    hhUrl: state.hhUrl.trim() || undefined,
    resumeDraft: ingested?.draft,
    parsedResume: ingested?.parsed,
    resumeImported: ingested?.imported,
  };
}
