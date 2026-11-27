import type { SectionProps } from '../sections';
import { NodeStub } from '../shell/NodeStub';
import { EntriesScreen } from './EntriesScreen';
import { GoalCardScreen } from './GoalCardScreen';
import { GoalFormScreen } from './GoalFormScreen';
import { GoalsScreen } from './GoalsScreen';
import { KpiReviewScreen } from './KpiReviewScreen';
import { KpiUploadScreen } from './KpiUploadScreen';
import { WeekScreen } from './WeekScreen';
import { useB640Title } from '../kit/useB640Title';
import { useDiaryTitleTip } from './diaryTitleTip';

/** Вход раздела «Дневник»: экран по коду узла (B662). */
export default function Section({ node, params }: SectionProps) {
  useB640Title('Дневник');
  useDiaryTitleTip(node);
  if (node.code === 'd00') return <EntriesScreen node={node} />;
  if (node.code === 'd00d') return <WeekScreen node={node} />;
  if (node.code === 'd02') return <GoalsScreen node={node} />;
  if (node.code === 'd02b') return <GoalFormScreen node={node} />;
  if (node.code === 'd02k') return <KpiUploadScreen node={node} />;
  if (node.code === 'd02l') return <KpiReviewScreen node={node} />;
  if (node.code === 'd02a' && params.goalId) {
    return <GoalCardScreen key={params.goalId} node={node} goalId={params.goalId} />;
  }
  return <NodeStub node={node} />;
}
