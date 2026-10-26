import { useMemo, useState, type ReactElement } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { formatVacancyCount } from './careerWageFork';
import { mapProposedRolesToCareerRoles } from './roleHypothesisAdapter';
import { acceptRole, dismissRoleOffer, useCareerRoles } from './careerRoleStore';

/**
 * «Принять роль …» в панели консультанта на «Карьере» (макет 3, B445).
 *
 * Предлагается роль, чьи требования рынка совпали с навыками кандидата, ещё не
 * его (не выбрана, не принята, навыки по ней не проверены) и не отложенная им. «Принять» выбирает её в «Стратегии» на сервере, «Не
 * сейчас» записывается туда же, где хранятся отклонённые предложения, — и то,
 * и другое переживает перезагрузку. Роли читает экран «Карьера»; панель
 * своего чтения не делает.
 */
function useOfferedRole() {
  const store = useCareerRoles(false);
  const role = useMemo(
    () =>
      mapProposedRolesToCareerRoles(store.roles, {
        acceptedTitle: store.acceptedTitle,
        offersDismissed: store.offersDismissed,
        checkedTitles: store.checkedTitles,
        checkedSkills: store.checkedSkills,
      }).find(
        (item) =>
          item.status === 'skills_checked' &&
          !item.alreadyChosen &&
          !item.offerDismissed &&
          !store.rejected.includes(item.id) &&
          item.vacancyCount > 0,
      ),
    [
      store.roles,
      store.acceptedTitle,
      store.offersDismissed,
      store.checkedTitles,
      store.checkedSkills,
      store.rejected,
    ],
  );
  return { store, role };
}

export function CareerRoleOffer(): ReactElement | null {
  const { store, role } = useOfferedRole();
  const [busy, setBusy] = useState(false);
  if (store.status !== 'ready' || !role) return null;
  const title = `Принять роль ${role.title}`;
  const run = (action: () => Promise<boolean>) => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };
  return (
    <section className="career-expert-proposal" aria-label={title} data-testid="career-role-offer">
      <p className="career-expert-proposal-title">{title}</p>
      <p>
        Подборка пересчитается, в ней появится {formatVacancyCount(role.vacancyCount)}
        {role.observedDate ? ` (срез ${role.observedDate})` : ''}.
      </p>
      {store.actionError ? (
        <p className="career-expert-proposal-error" role="alert">
          {store.actionError}
        </p>
      ) : null}
      <div className="career-expert-actions">
        <button
          type="button"
          className="career-quiet-button career-inline-ok"
          disabled={busy}
          onClick={() => run(() => acceptRole(role.title))}
        >
          <Check size={16} aria-hidden="true" />
          Принять
        </button>
        <button
          type="button"
          className="career-quiet-button"
          disabled={busy}
          onClick={() => run(() => dismissRoleOffer(role.id))}
        >
          <X size={16} aria-hidden="true" />
          Не сейчас
        </button>
      </div>
    </section>
  );
}
