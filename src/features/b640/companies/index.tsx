import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { CompanyScreen } from './card/CompanyScreen';
import { CompanyListScreen } from './list/CompanyListScreen';
import './companies.css';
import { useB640Title } from '../kit/useB640Title';

/** Вход раздела «Компании и люди»: список компаний подборки и карточка компании. */
export default function Section({ node, params }: SectionProps) {
  useB640Title('Вакансии');
  if (node.code === 'v10') return <CompanyListScreen />;
  if (node.code === 'v10b') return <CompanyScreen companyId={params.companyId ?? ''} />;
  return <NodeStub node={node} />;
}
