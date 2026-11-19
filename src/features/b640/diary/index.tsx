import type { SectionProps } from '../sections';
import { NodeStub } from '../shell/NodeStub';
import { EntriesScreen } from './EntriesScreen';
import { GoalCardScreen } from './GoalCardScreen';
import { GoalFormScreen } from './GoalFormScreen';
import { GoalsScreen } from './GoalsScreen';
import { WeekScreen } from './WeekScreen';

/** Вход раздела «Дневник»: экран по коду узла (B662). */
export default function Section({ node, params }: SectionProps) {
  if (node.code === 'd00') return <EntriesScreen node={node} />;
  if (node.code === 'd00d') return <WeekScreen node={node} />;
  if (node.code === 'd02') return <GoalsScreen node={node} />;
  if (node.code === 'd02b') return <GoalFormScreen node={node} />;
  if (node.code === 'd02a' && params.goalId) {
    return <GoalCardScreen key={params.goalId} node={node} goalId={params.goalId} />;
  }
  return <NodeStub node={node} />;
}
