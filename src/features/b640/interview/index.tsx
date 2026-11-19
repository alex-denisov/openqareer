import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { PrepScreen } from './PrepScreen';

/** Вход раздела «Подготовка»: I1 — подготовка к интервью (I1d — интервью ещё не записано). */
export default function Section({ node, params }: SectionProps) {
  switch (node.code) {
    case 'i01':
      return <PrepScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    default:
      return <NodeStub node={node} />;
  }
}
