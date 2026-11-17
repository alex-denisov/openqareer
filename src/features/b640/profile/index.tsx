import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { ConnectionsScreen } from './ConnectionsScreen';
import { ExperienceEditScreen } from './ExperienceEditScreen';
import { HistoryScreen } from './HistoryScreen';
import { ProfileScreen } from './ProfileScreen';
import { QuestionScreen } from './QuestionScreen';
import { ReviewScreen } from './ReviewScreen';
import { SourcesScreen } from './SourcesScreen';
import { StatusChoiceScreen } from './StatusChoiceScreen';

/** Вход раздела «Профиль»: экран по коду узла (см. ../README.md). */
export default function Section({ node, params }: SectionProps) {
  if (node.code === 's01') return <ProfileScreen node={node} />;
  if (node.code === 's02') return <StatusChoiceScreen node={node} />;
  if (node.code === 'p06') return <ReviewScreen node={node} />;
  if (node.code === 'p07') {
    return <ExperienceEditScreen node={node} entryId={params.entryId ?? ''} />;
  }
  if (node.code === 'p04') return <SourcesScreen node={node} />;
  if (node.code === 'p09') return <QuestionScreen node={node} />;
  if (node.code === 'p11') return <ConnectionsScreen node={node} />;
  if (node.code === 'p10') return <HistoryScreen node={node} />;
  return <NodeStub node={node} />;
}
