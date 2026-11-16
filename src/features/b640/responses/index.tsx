import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { CompanyWantsScreen } from './CompanyWantsScreen';
import { FunnelScreen } from './FunnelScreen';
import { ResponsesScreen } from './ResponsesScreen';
import { ReviewScreen } from './ReviewScreen';
import './responses.css';

/** Вход раздела «Отклики»: экран по коду узла (см. ../README.md). */
export default function Section({ node, params }: SectionProps) {
  switch (node.code) {
    case 'o01':
      return <ResponsesScreen nodeCode="o01" openId={null} />;
    case 'o01c':
      return <ResponsesScreen nodeCode="o01c" openId={params.responseId ?? null} />;
    case 'o01e':
      return <FunnelScreen />;
    case 'o07':
      return <ReviewScreen />;
    case 'o08':
      return <CompanyWantsScreen />;
    default:
      return <NodeStub node={node} />;
  }
}
