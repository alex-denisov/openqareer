import type { SectionProps } from '../sections';
import { NodeStub } from '../shell/NodeStub';
import { EntriesScreen } from './EntriesScreen';
import { WeekScreen } from './WeekScreen';

/** Вход раздела «Дневник»: экран по коду узла (B662). */
export default function Section({ node }: SectionProps) {
  if (node.code === 'd00') return <EntriesScreen node={node} />;
  if (node.code === 'd00d') return <WeekScreen node={node} />;
  return <NodeStub node={node} />;
}
