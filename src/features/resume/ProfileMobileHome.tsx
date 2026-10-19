import { ProfileEmptyStart } from './ProfileEmptyStart';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';
import { useState } from 'react';
import { pluralRu } from '../../../shared/pluralRu';
import {
  linkedinImportProgressView,
  useLinkedInImportProgress,
} from '../connections/linkedinImportProgress';
import {
  Briefcase,
  Files,
  FileText,
  Gauge,
  LinkedinLogo,
  MapTrifold,
  Plus,
  ShieldCheck,
  Sparkle,
  Student,
  Target,
  Translate,
  UserCircle,
  CaretRight,
} from '@phosphor-icons/react';
import { useCandidateMediaSrc } from './candidateMediaSrc';
import { ProfileMobileGroup, ProfileMobileRow, profileMobileDate } from './ProfileMobileElements';
import type { ProfileMobileDataProps } from './profileMobileTypes';
import type { ProfileMobileRoute } from './profileMobileNavigation';
import type { ProfileTab } from './profileTabs';

interface HomeProps extends ProfileMobileDataProps {
  readonly open: (route: ProfileMobileRoute) => void;
  readonly activeTab: ProfileTab;
  readonly onTab: (tab: ProfileTab) => void;
  readonly isDraftEmpty?: boolean;
  readonly atsScore: number | null;
  readonly reviewCount?: number;
  readonly versionCount?: number;
  readonly relocationLabel: string;
}

function MobileAtsRing({ value }: { readonly value: number | null }) {
  const circumference = 2 * Math.PI * 19.5;
  return (
    <span className="pm-ats-r">
      <svg className="pm-ring" viewBox="0 0 44 44" aria-hidden="true">
        <circle
          cx="22"
          cy="22"
          r="19.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity=".14"
          strokeWidth="5"
        />
        <circle
          cx="22"
          cy="22"
          r="19.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeOpacity={value === null ? 0 : 1}
          strokeDasharray={`${(circumference * (value ?? 0)) / 100} ${circumference}`}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <b className="num">{value ?? '—'}</b>
    </span>
  );
}

function MobileAtsBadge({ atsScore, open }: Pick<HomeProps, 'atsScore' | 'open'>) {
  return (
    <button
      className="pm-ats"
      data-score-known={atsScore !== null}
      type="button"
      aria-label={
        atsScore === null ? 'Прохождение ATS: не рассчитано' : `Прохождение ATS: ${atsScore} из 100`
      }
      onClick={() => open({ page: 'ats' })}
    >
      <MobileAtsRing value={atsScore} />
      <small>ATS</small>
    </button>
  );
}

function MobileProfileIdentity({
  draft,
  atsScore,
  open,
}: Pick<HomeProps, 'draft' | 'atsScore' | 'open'>) {
  const src = useCandidateMediaSrc(draft.candidate.photoMediaId);
  const [broken, setBroken] = useState(false);
  const initials = (draft.candidate.fullName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  const current = draft.experience.find((entry) => entry.current);
  // Макет 390: «должность · компания» текущего места; заголовок резюме — только если места нет.
  const role = current?.title?.trim() || draft.candidate.headline?.trim() || draft.targetRole;
  return (
    <div className="pm-id">
      {src && !broken ? (
        <img className="avatar" src={src} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
      )}
      <div>
        <h2 aria-label={draft.candidate.fullName || 'Имя не указано'}>
          <button
            type="button"
            className="profile-name-control"
            aria-label="Изменить основные данные профиля"
            onClick={() => open({ page: 'contacts' })}
          >
            {draft.candidate.fullName || 'Имя не указано'}
          </button>
        </h2>
        <p>{[role, current?.employer].filter(Boolean).join(' · ') || 'Роль не указана'}</p>
      </div>
      <MobileAtsBadge atsScore={atsScore} open={open} />
    </div>
  );
}

export function ProfileMobileTabs({
  activeTab,
  onTab,
  disabled = false,
}: Pick<HomeProps, 'activeTab' | 'onTab'> & { readonly disabled?: boolean }) {
  const tabs = [
    ['resume', 'Резюме'],
    ['skills', 'Навыки'],
    ['trace', 'След'],
  ] as const;
  return (
    <div className="pm-seg" role="tablist" aria-label="Профиль">
      {tabs.map(([id, label], index) => (
        <button
          type="button"
          role="tab"
          id={`profile-mobile-tab-${id}`}
          key={id}
          aria-selected={activeTab === id}
          aria-controls={`profile-panel-${id}`}
          tabIndex={disabled || activeTab !== id ? -1 : 0}
          disabled={disabled}
          onClick={() => onTab(id)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : undefined;
            if (next === undefined) return;
            event.preventDefault();
            onTab(tabs[next][0]);
            document.getElementById(`profile-mobile-tab-${tabs[next][0]}`)?.focus();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ProfileMobileSources({
  importedSources,
  onSelect,
  showTitle = true,
}: Pick<ProfileMobileDataProps, 'importedSources'> & {
  readonly onSelect?: () => void;
  readonly showTitle?: boolean;
}) {
  const progress = linkedinImportProgressView(useLinkedInImportProgress());
  return (
    <ProfileMobileGroup title={showTitle ? 'Источники' : undefined}>
      {(['linkedin', 'hh'] as const).map((platform) => {
        const source = importedSources?.find((item) => item.platform === platform);
        return (
          <ProfileMobileRow
            key={platform}
            icon={platform === 'linkedin' ? LinkedinLogo : FileText}
            title={platform === 'linkedin' ? 'LinkedIn' : 'hh.ru'}
            detail={
              platform === 'linkedin' && progress
                ? `читаем разделы, ${progress.readCount} из ${progress.total}`
                : source
                  ? pluralRu(source.factCount, ['факт', 'факта', 'фактов'])
                  : 'Не импортировано'
            }
            value={profileMobileDate(source?.lastImportedAt)}
            onClick={onSelect}
          />
        );
      })}
      <ProfileMobileRow icon={Plus} title="Добавить источник" onClick={onSelect} />
    </ProfileMobileGroup>
  );
}

function ProfileMobileDataRows({
  draft,
  open,
  relocationLabel,
}: Pick<HomeProps, 'draft' | 'open' | 'relocationLabel'>) {
  return (
    <ProfileMobileGroup title="Данные профиля">
      <ProfileMobileRow icon={UserCircle} title="Обо мне" onClick={() => open({ page: 'about' })} />
      <ProfileMobileRow
        icon={Briefcase}
        title="Опыт"
        value={pluralRu(draft.experience.length, ['место', 'места', 'мест'])}
        onClick={() => open({ page: 'exp' })}
      />
      <ProfileMobileRow
        icon={Student}
        title="Образование"
        value={draft.education.length}
        onClick={() => open({ page: 'edu' })}
      />
      <ProfileMobileRow
        icon={Target}
        title="Проекты"
        value={draft.projects?.length ?? 0}
        onClick={() => open({ page: 'proj' })}
      />
      <ProfileMobileRow
        icon={Translate}
        title="Языки"
        value={draft.languages.length}
        onClick={() => open({ page: 'lang' })}
      />
      <ProfileMobileRow
        icon={MapTrifold}
        title="Релокация"
        value={relocationLabel}
        onClick={() => open({ page: 'reloc' })}
      />
    </ProfileMobileGroup>
  );
}

function ProfileMobileReadiness(props: HomeProps) {
  return (
    <ProfileMobileGroup title="Готовность к откликам">
      <ProfileMobileRow
        icon={Gauge}
        title="Прохождение ATS"
        detail="Как резюме читают системы найма"
        value={props.atsScore === null ? 'Не рассчитано' : `${props.atsScore} из 100`}
        onClick={() => props.open({ page: 'ats' })}
      />
      <ProfileMobileRow
        icon={ShieldCheck}
        title="Проверка"
        detail="Что поправить до отправки"
        value={
          props.reviewCount === undefined
            ? '—'
            : pluralRu(props.reviewCount, ['замечание', 'замечания', 'замечаний'])
        }
        warning={Boolean(props.reviewCount)}
        onClick={() => props.open({ page: 'check' })}
      />
      <ProfileMobileRow
        icon={Files}
        title="Версии под вакансии"
        detail="Мастер-резюме и снимки"
        value={props.versionCount ?? '—'}
        onClick={() => props.open({ page: 'docs' })}
      />
    </ProfileMobileGroup>
  );
}

export function ProfileMobileEmptyResume({
  open,
  onOpenConnections,
  onOpenExpert,
  onRetry,
}: Pick<HomeProps, 'open' | 'onOpenConnections'> & {
  readonly onOpenExpert?: () => void;
  readonly onRetry?: () => void;
}) {
  return (
    <div
      className="pm-pane"
      id="profile-panel-resume"
      role="tabpanel"
      aria-labelledby="profile-mobile-tab-resume"
    >
      <ProfileEmptyStart
        variant="mobile"
        onOpenConnections={onOpenConnections}
        onOpenExpert={onOpenExpert}
        onFillManually={() => open({ page: 'contacts' })}
        onImported={() => onRetry?.()}
      />
    </div>
  );
}

/** What the pending edits touch, as far as the command says: dates or experience bullets. */
function suggestionTopics(pending: readonly InlineSuggestionItem[]): string {
  const topics = new Set(pending.map((item) => (item.field ? 'даты' : 'пункты опыта')));
  return [...topics].sort((a) => (a === 'даты' ? 1 : -1)).join(' и ');
}

/** The pending edits lead to one nested page: «Опыт» when it has any, otherwise «Обо мне». */
function pendingSuggestionTarget(pending: readonly InlineSuggestionItem[]) {
  return pending.some((item) => item.section === 'experience')
    ? { page: 'exp' as const, block: 'Опыт' }
    : { page: 'about' as const, block: 'Обо мне' };
}

export function ProfileMobileResumeHome(props: HomeProps) {
  const pending = (props.suggestions ?? []).filter(
    (suggestion) =>
      (suggestion.section === 'experience' || suggestion.section === 'about') &&
      !suggestion.applied,
  );
  const target = pendingSuggestionTarget(pending);
  const targetPending = pending.filter((item) =>
    target.page === 'exp' ? item.section === 'experience' : item.section === 'about',
  );
  return (
    <div
      className="pm-pane"
      id="profile-panel-resume"
      role="tabpanel"
      aria-labelledby="profile-mobile-tab-resume"
    >
      {pending.length ? (
        <button
          type="button"
          className="pm-focus"
          onClick={() => props.open({ page: target.page })}
        >
          <Sparkle size="1em" aria-hidden="true" />
          <span>
            <b>
              Консультант предложил {pluralRu(targetPending.length, ['правку', 'правки', 'правок'])}
            </b>
            <small>
              {target.page === 'exp'
                ? `Блок «Опыт»: ${suggestionTopics(targetPending)}`
                : 'Блок «Обо мне»: текст раздела'}
            </small>
          </span>
          <CaretRight className="pm-chev" size="1em" aria-hidden="true" />
        </button>
      ) : null}
      <ProfileMobileDataRows {...props} />
      <ProfileMobileReadiness {...props} />
      <ProfileMobileSources
        importedSources={props.importedSources}
        onSelect={() => props.open({ page: 'src' })}
      />
    </div>
  );
}

export function ProfileMobileHomeIdentity(props: HomeProps) {
  return (
    <>
      <MobileProfileIdentity {...props} />
      <ProfileMobileTabs {...props} />
    </>
  );
}
