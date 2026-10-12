import type { CareerCommand } from '../coach/coachApi';

export type CareerDiaryAchievementProfileStatus = 'none' | 'prepared' | 'added' | 'reverted' | 'failed';

export function careerDiaryAchievementProfileStatus(
  achievementId: string,
  commands: readonly CareerCommand[],
): CareerDiaryAchievementProfileStatus {
  const sourcePrefix = 'diary:' + achievementId + ':';
  const matches = commands.filter((item) =>
    item.provenance?.evidenceRefs.some((ref) => ref.startsWith(sourcePrefix)),
  );
  const command = matches.filter((item) => !item.profileRevisionReverted).at(-1);
  if (!command) return matches.length ? 'reverted' : 'none';
  if (command.status === 'completed_with_receipt') return 'added';
  if (command.status === 'failed') return 'failed';
  return 'prepared';
}
