import { vacancyAge } from './vacancyFilters';

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
        от <span className="career-mono">{comp.slice(3)}</span>
      </>
    ) : comp.startsWith('до ') ? (
      <>
        до <span className="career-mono">{comp.slice(3)}</span>
      </>
    ) : (
      <span className="career-mono">{comp}</span>
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
