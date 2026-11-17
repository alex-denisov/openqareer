import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { ExperienceEditScreen } from './ExperienceEditScreen';
import { ProfileScreen } from './ProfileScreen';
import { ReviewScreen } from './ReviewScreen';
import { StatusChoiceScreen } from './StatusChoiceScreen';

/** Вход раздела «Профиль»: экран по коду узла (см. ../README.md). */
export default function Section({ node, params }: SectionProps) {
  if (node.code === 's01') return <ProfileScreen node={node} />;
  if (node.code === 's02') return <StatusChoiceScreen node={node} />;
  if (node.code === 'p06') return <ReviewScreen node={node} />;
  if (node.code === 'p07') {
    return <ExperienceEditScreen node={node} entryId={params.entryId ?? ''} />;
  }
  return <NodeStub node={node} />;
}
