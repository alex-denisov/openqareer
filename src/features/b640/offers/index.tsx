import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { OfferTermsScreen } from './OfferTermsScreen';
import { OffersScreen } from './OffersScreen';
import { useB640Title } from '../kit/useB640Title';

/** Вход раздела «Офферы»: O6 — сравнение и решение, O6a — условия одного оффера. */
export default function Section({ node, params }: SectionProps) {
  useB640Title('Отклики');
  switch (node.code) {
    case 'o06':
      return <OffersScreen />;
    case 'o06a':
      return <OfferTermsScreen key={params.offerId} offerId={params.offerId ?? ''} />;
    default:
      return <NodeStub node={node} />;
  }
}
