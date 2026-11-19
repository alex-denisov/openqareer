import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { CompanyScreen } from './card/CompanyScreen';
import { CompanyListScreen } from './list/CompanyListScreen';

/** Вход раздела «Компании и люди»: список компаний подборки и карточка компании. */
export default function Section({ node, params }: SectionProps) {
  if (node.code === 'v10') return <CompanyListScreen />;
  if (node.code === 'v10b') return <CompanyScreen companyId={params.companyId ?? ''} />;
  return <NodeStub node={node} />;
}
