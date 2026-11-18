import { NodeStub } from '../shell/NodeStub';
import './footprint.css';
import type { SectionProps } from '../sections';
import { FindingScreen } from './FindingScreen';
import { FindingsScreen } from './FindingsScreen';
import { FootprintScreen } from './FootprintScreen';

/** Вход вкладки «Цифровой след»: экран по коду узла (см. ../README.md). */
export default function Section({ node, params }: SectionProps) {
  if (node.code === 'p02' || node.code === 'f01') return <FootprintScreen node={node} />;
  if (node.code === 'f03') return <FindingsScreen node={node} />;
  if (node.code === 'f03b') return <FindingScreen node={node} findingId={params.findingId ?? ''} />;
  return <NodeStub node={node} />;
}
