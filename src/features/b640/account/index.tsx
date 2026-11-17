import type { SectionProps } from '../sections';
import { NodeStub } from '../shell/NodeStub';
import { AppScreen } from './AppScreen';
import { BillingScreen } from './BillingScreen';
import { ConnectionsScreen } from './ConnectionsScreen';
import { DataScreen } from './DataScreen';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';
import { SectionsScreen } from './SectionsScreen';
import { SecurityScreen } from './SecurityScreen';
import { TariffsScreen } from './TariffsScreen';

/** Вход раздела «Аккаунт»: экран по коду узла (B661). */
export default function Section({ node }: SectionProps) {
  if (node.code === 'n00') return <SectionsScreen node={node} />;
  if (node.code === 'n03') return <ConnectionsScreen node={node} />;
  if (node.code === 'n02') return <NotificationSettingsScreen node={node} />;
  if (node.code === 'n04') return <SecurityScreen node={node} />;
  if (node.code === 'n05') return <DataScreen node={node} />;
  if (node.code === 'n06') return <AppScreen node={node} />;
  if (node.code === 't03') return <BillingScreen node={node} />;
  if (node.code === 't01') return <TariffsScreen node={node} />;
  return <NodeStub node={node} />;
}
