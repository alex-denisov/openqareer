import { vacancyAge } from './vacancyFilters';
import { pluralRu } from '../../../shared/pluralRu';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import { CircleNotch, Star, Target } from '@phosphor-icons/react';

export function vacancySnapshot(
  cluster: MatchedVacancyItem['cluster'],
): VacancyApplicationSnapshot {
  return {
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany ?? '',
    url: cluster.primaryUrl,
    source: cluster.sources[0]?.sourceId ?? '',
  };
}

export function VacancyRowMeta({
  comp,
  age,
  alreadyApplied,
  applicationArchived,
}: {
  readonly comp: string;
  readonly age: ReturnType<typeof vacancyAge>;
  readonly alreadyApplied: boolean;
  readonly applicationArchived: boolean;
}) {
  const ageText = age.days === 0 ? 'сегодня' : age.label;
  const compContent =
    comp === 'не указана' ? (
      comp
    ) : comp.startsWith('от ') ? (
      <>
        от <span className="career-numeric">{comp.slice(3)}</span>
      </>
    ) : comp.startsWith('до ') ? (
      <>
        до <span className="career-numeric">{comp.slice(3)}</span>
      </>
    ) : (
      <span className="career-numeric">{comp}</span>
    );
  return (
    <span>
      <span className="vac-comp">{compContent}</span>
      <span className="vac-age">
        {applicationArchived
          ? 'Отклик в архиве'
          : alreadyApplied
            ? `Отклик отмечен · ${age.days === 0 ? 'сегодня' : `${age.label} назад`}`
            : `в базе ${ageText}`}
      </span>
    </span>
  );
}

export interface VacancyCollectionActionProps {
  readonly compact?: boolean;
  readonly isSaved?: boolean;
  readonly saveBusy?: boolean;
  readonly onToggleSaved?: () => void | Promise<void>;
  readonly isCompanyWanted?: boolean;
  readonly companyWantKnown?: boolean;
  readonly companyWantBusy?: boolean;
  readonly onToggleCompanyWant?: () => void | Promise<void>;
}

function SavedVacancyAction({ props }: { readonly props: VacancyCollectionActionProps }) {
  const label = props.saveBusy
    ? 'Сохраняем вакансию…'
    : props.isSaved
      ? 'Убрать из сохранённых'
      : 'Сохранить вакансию';
  const compactLabel = props.isSaved ? 'Убрать из сохранённых' : 'Сохранить';
  return (
    <button
      type="button"
      className={`career-vacancy-action${props.compact ? ' vacancies-icon-action' : ''}`}
      data-vacancy-action="save"
      aria-label={props.compact ? compactLabel : undefined}
      title={
        props.saveBusy ? label : props.isSaved ? 'Убрать из сохранённых' : 'Сохранить вакансию'
      }
      aria-pressed={Boolean(props.isSaved)}
      aria-busy={Boolean(props.saveBusy)}
      disabled={props.saveBusy}
      onClick={() => void props.onToggleSaved?.()}
    >
      {props.compact ? (
        props.saveBusy ? (
          <CircleNotch size={18} className="vacancies-icon-action-spinner" aria-hidden="true" />
        ) : (
          <Star size={18} weight={props.isSaved ? 'fill' : 'regular'} aria-hidden="true" />
        )
      ) : (
        label
      )}
    </button>
  );
}

function WantCompanyAction({ props }: { readonly props: VacancyCollectionActionProps }) {
  const label = props.companyWantBusy
    ? 'Обновляем список «Хочу»…'
    : props.isCompanyWanted
      ? 'Убрать из «Хочу»'
      : 'Хочу в эту компанию';
  return (
    <button
      type="button"
      className={`career-vacancy-action${props.compact ? ' vacancies-icon-action' : ''}`}
      data-vacancy-action="want-company"
      aria-label={label}
      title={label}
      aria-pressed={props.companyWantKnown ? Boolean(props.isCompanyWanted) : undefined}
      aria-busy={props.companyWantBusy}
      disabled={props.companyWantBusy}
      onClick={() => void props.onToggleCompanyWant?.()}
    >
      {props.compact ? (
        props.companyWantBusy ? (
          <CircleNotch size={18} className="vacancies-icon-action-spinner" aria-hidden="true" />
        ) : (
          <Target
            size={18}
            weight={props.isCompanyWanted ? 'fill' : 'regular'}
            aria-hidden="true"
          />
        )
      ) : (
        label
      )}
    </button>
  );
}

export function VacancyCollectionActions(props: VacancyCollectionActionProps) {
  if (!props.onToggleSaved && !props.onToggleCompanyWant) return null;
  return (
    <div
      className={`career-vacancy-actions vacancy-collection-actions${props.compact ? ' is-compact' : ''}`}
    >
      {props.onToggleSaved ? <SavedVacancyAction props={props} /> : null}
      {props.onToggleCompanyWant ? <WantCompanyAction props={props} /> : null}
    </div>
  );
}

export function CompanyPathButton({
  count,
  onOpen,
}: {
  readonly count: number | null | undefined;
  readonly onOpen: () => void;
}) {
  const label =
    count === undefined
      ? 'Путь к компании'
      : count === null
        ? 'Путь к компании · контакты неизвестны'
        : `Путь к компании · ${count} ${pluralRu(count, ['контакт', 'контакта', 'контактов'])}`;
  return (
    <div className="career-vacancy-actions vacancy-collection-actions">
      <button type="button" className="career-vacancy-action" onClick={onOpen}>
        {label}
      </button>
    </div>
  );
}

export function NotAppliedActions({
  savingApplied,
  externalOpened,
  onApplyExternal,
  onConfirmSent,
  onConfirmAlreadyApplied,
}: {
  readonly savingApplied: boolean;
  readonly externalOpened: boolean;
  readonly onApplyExternal: () => void;
  readonly onConfirmSent: () => void;
  readonly onConfirmAlreadyApplied?: () => void;
}) {
  if (externalOpened) {
    return (
      <button type="button" className="btn btn-primary action-btn" onClick={onConfirmSent}>
        Да, отклик отправлен
      </button>
    );
  }
  return (
    <>
      <button type="button" className="btn btn-primary action-btn" onClick={onApplyExternal}>
        Откликнуться
      </button>
      {onConfirmAlreadyApplied ? (
        <button
          type="button"
          className="btn btn-secondary action-btn"
          disabled={savingApplied}
          onClick={onConfirmAlreadyApplied}
        >
          {savingApplied ? 'Сохраняем…' : 'Я уже откликнулся'}
        </button>
      ) : null}
    </>
  );
}

export function VacancyMoreActions({
  onDiscussWithConsultant,
  onOpenNetworking,
}: {
  readonly onDiscussWithConsultant?: () => void;
  readonly onOpenNetworking?: () => void;
}) {
  return (
    <>
      {onDiscussWithConsultant ? (
        <button
          type="button"
          className="btn btn-secondary action-btn"
          onClick={onDiscussWithConsultant}
        >
          Обсудить с консультантом
        </button>
      ) : null}
      {onOpenNetworking ? (
        <button type="button" className="btn btn-secondary action-btn" onClick={onOpenNetworking}>
          Нетворкинг
        </button>
      ) : null}
    </>
  );
}
