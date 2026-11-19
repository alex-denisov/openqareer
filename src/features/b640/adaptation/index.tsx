import type { SectionProps } from '../sections';
import { NodeStub } from '../shell/NodeStub';
import { Day30Screen } from './Day30Screen';
import { MeetingScreen } from './MeetingScreen';
import { PeopleScreen } from './PeopleScreen';
import { PlanScreen } from './PlanScreen';
import { ResultsScreen } from './ResultsScreen';
import { StepScreen, STEP_OF_NODE } from './StepScreen';

/**
 * Вход раздела «Адаптация» (B663): экран узла выбирается по `node.code`.
 * d01e и d04 — проверка на 30-й день и итоги 90 дней (B687).
 */
export default function Section({ node }: SectionProps) {
  if (node.code === 'd01') return <PlanScreen node={node} />;
  if (node.code === 'd01c') return <MeetingScreen node={node} />;
  if (node.code === 'd01d') return <PeopleScreen node={node} />;
  if (node.code === 'd01e') return <Day30Screen node={node} />;
  if (node.code === 'd04') return <ResultsScreen node={node} />;
  if (STEP_OF_NODE[node.code]) return <StepScreen node={node} />;
  return <NodeStub node={node} />;
}
