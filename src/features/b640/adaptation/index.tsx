import type { SectionProps } from '../sections';
import { NodeStub } from '../shell/NodeStub';
import { MeetingScreen } from './MeetingScreen';
import { PeopleScreen } from './PeopleScreen';
import { PlanScreen } from './PlanScreen';
import { StepScreen, STEP_OF_NODE } from './StepScreen';

/**
 * Вход раздела «Адаптация» (B663): экран узла выбирается по `node.code`.
 * d01e и d04 ждут механики B687 и пока показывают заглушку основы.
 */
export default function Section({ node }: SectionProps) {
  if (node.code === 'd01') return <PlanScreen node={node} />;
  if (node.code === 'd01c') return <MeetingScreen node={node} />;
  if (node.code === 'd01d') return <PeopleScreen node={node} />;
  if (STEP_OF_NODE[node.code]) return <StepScreen node={node} />;
  return <NodeStub node={node} />;
}
