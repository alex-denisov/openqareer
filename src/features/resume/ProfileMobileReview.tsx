import {
  Briefcase,
  Question,
  Sparkle,
  Student,
  Target,
  Translate,
  UserCircle,
  type Icon,
} from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import { ProfileMobileGroup, ProfileMobileRow } from './ProfileMobileElements';
import { profileCompleteness } from './profileCompleteness';
import {
  profileResumeReviewBlocks,
  type ReviewBlock,
  type ReviewBlockId,
} from './ProfileReviewAndVersions';
import type { ProfileMobileDataProps, ProfileMobileNavigationProps } from './profileMobileTypes';
import type { ProfileMobileRoute } from './profileMobileNavigation';

const BLOCK_ICONS: Record<ReviewBlockId, Icon> = {
  experience: Briefcase,
  about: UserCircle,
  education: Student,
  projects: Target,
  languages: Translate,
  confirmations: Question,
};
const BLOCK_ROUTES: Partial<Record<ReviewBlockId, ProfileMobileRoute>> = {
  experience: { page: 'exp' },
  about: { page: 'about' },
  education: { page: 'edu' },
  projects: { page: 'proj' },
  languages: { page: 'lang' },
};

function ReviewCompleteness({ draft }: Pick<ProfileMobileDataProps, 'draft'>) {
  const completeness = profileCompleteness(draft);
  return (
    <>
      <div className="pm-hero">
        <h2>
          Заполнено {completeness.completedCount} из {completeness.totalCount} блоков
        </h2>
        <p>
          {completeness.missingSections.length
            ? `Не заполнено: ${completeness.missingSections.join(', ').toLocaleLowerCase('ru-RU')}`
            : 'Все блоки заполнены'}
        </p>
      </div>
      <div
        className="pm-blocks"
        role="img"
        aria-label={`${completeness.completedCount} из ${completeness.totalCount}`}
      >
        {Array.from({ length: completeness.totalCount }, (_, index) => (
          <i key={index} className={index < completeness.completedCount ? 'on' : undefined} />
        ))}
      </div>
    </>
  );
}

function ReviewBlockRow({
  block,
  open,
}: {
  readonly block: ReviewBlock;
  readonly open: ProfileMobileNavigationProps['open'];
}) {
  const route = BLOCK_ROUTES[block.id];
  const count = block.issueCount ?? block.issues.length;
  const detail =
    block.description ??
    (block.issues.length
      ? block.issues.map((issue) => issue.message).join(' ')
      : block.hasData
        ? 'Замечаний нет'
        : 'Нет данных');
  return (
    <ProfileMobileRow
      icon={BLOCK_ICONS[block.id]}
      title={block.label}
      detail={detail}
      value={count || undefined}
      warning={count > 0}
      onClick={route ? () => open(route) : undefined}
    />
  );
}

export function ProfileMobileReview(props: ProfileMobileDataProps & ProfileMobileNavigationProps) {
  const blocks = profileResumeReviewBlocks(props.view, props.draft, props.memory);
  const confirmations = blocks.find((block) => block.id === 'confirmations');
  const pending = confirmations?.issueCount ?? confirmations?.issues.length ?? 0;
  const discuss = props.onFillQuestionnaire
    ? () => props.onFillQuestionnaire?.('Проверка резюме')
    : props.onOpenExpert;
  return (
    <>
      <ReviewCompleteness draft={props.draft} />
      <ProfileMobileGroup title="Замечания">
        {blocks
          .filter((block) => block.id !== 'confirmations')
          .map((block) => (
            <ReviewBlockRow key={block.id} block={block} open={props.open} />
          ))}
      </ProfileMobileGroup>
      {pending ? (
        <ProfileMobileGroup title="Ждут подтверждения">
          <ProfileMobileRow
            icon={Question}
            title={pluralRu(pending, ['факт', 'факта', 'фактов'])}
            detail="Подтверждаете вы, мы работодателя не проверяем"
            value="Проверить"
            onClick={discuss}
          />
        </ProfileMobileGroup>
      ) : null}
      <button type="button" className="pm-cta" disabled={!discuss} onClick={discuss}>
        <Sparkle size="1em" aria-hidden="true" />
        Собрать факты с консультантом
      </button>
    </>
  );
}
