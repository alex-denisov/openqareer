import { startEarlyRead } from '../../shell/earlyRead';
import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { ConnectionsScreen } from './ConnectionsScreen';
import { ExperienceEditScreen } from './ExperienceEditScreen';
import { HistoryScreen } from './HistoryScreen';
import { PhotoScreen } from './PhotoScreen';
import { loadTerms } from './profileAsideApi';
import { getIncome } from './profileExtrasApi';
import { getStatus } from './statusChoice';
import { loadProfile, ProfileScreen } from './ProfileScreen';
import { QuestionScreen } from './QuestionScreen';
import { ReviewScreen } from './ReviewScreen';
import { SourcesScreen } from './SourcesScreen';
import { StatusChoiceScreen } from './StatusChoiceScreen';
import { useB640Title } from '../kit/useB640Title';

/** B792: данные «Профиля» — рядом с вопросом о сессии. */
export function preload(code: string): void {
  if (code !== 's01') return;
  startEarlyRead(loadProfile);
  startEarlyRead(getStatus);
  startEarlyRead(getIncome);
  startEarlyRead(loadTerms);
}

/** Вход раздела «Профиль»: экран по коду узла (см. ../README.md). */
export default function Section({ node, params }: SectionProps) {
  useB640Title('Профиль');
  if (node.code === 's01') return <ProfileScreen node={node} />;
  if (node.code === 's02') return <StatusChoiceScreen node={node} />;
  if (node.code === 'p06') return <ReviewScreen node={node} />;
  if (node.code === 'p07') {
    return <ExperienceEditScreen node={node} entryId={params.entryId ?? ''} />;
  }
  if (node.code === 'p04') return <SourcesScreen node={node} />;
  if (node.code === 'p08') return <PhotoScreen node={node} />;
  if (node.code === 'p09') return <QuestionScreen node={node} />;
  if (node.code === 'p11') return <ConnectionsScreen node={node} />;
  if (node.code === 'p10') return <HistoryScreen node={node} />;
  return <NodeStub node={node} />;
}
