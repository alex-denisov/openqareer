import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { CardScreen } from './card/CardScreen';
import { ListScreen, SavedScreen } from './list';

/** Вход раздела «Вакансии»: подборка, сохранённые и карточка вакансии. */
export default function Section({ node, params }: SectionProps) {
  if (node.code === 's07') return <ListScreen />;
  if (node.code === 'v06s') return <SavedScreen />;
  if (node.code === 'v04') return <CardScreen vacancyId={params.vacancyId ?? ''} />;
  return <NodeStub node={node} />;
}
