import type { CareerAccountViewProps } from './accountViewTypes';
import { CareerAccountScreen } from './CareerAccountScreen';
import { useCareerAccountViewModel } from './useCareerAccountViewModel';

export type { CareerAccountViewActions, CareerAccountViewProps } from './accountViewTypes';

export function CareerAccountView(props: CareerAccountViewProps) {
  const model = useCareerAccountViewModel(props);
  if (props.loading || !props.account) return <AccountLoadingState props={props} />;
  return <CareerAccountScreen model={model} />;
}

function AccountLoadingState({ props }: { readonly props: CareerAccountViewProps }) {
  return (
    <div className="career-account-screen" aria-busy={props.loading}>
      {props.error ? (
        <div className="career-account-card" role="alert">
          <p>{props.error}</p>
          <button type="button" className="career-btn is-sm" disabled={props.busy} onClick={() => void props.actions.refresh()}>
            Повторить
          </button>
        </div>
      ) : (
        <p role="status">Загружаем настройки аккаунта.</p>
      )}
    </div>
  );
}
