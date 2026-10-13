import { CareerAccountDesktopView } from './CareerAccountDesktopView';
import { CareerAccountMobileView } from './CareerAccountMobileView';
import { CareerAccountDialogs } from './CareerAccountDialogs';
import type { AccountViewModel } from './accountViewTypes';

export function CareerAccountScreen({ model }: { readonly model: AccountViewModel }) {
  return (
    <div className="career-account-container">
      <AccountMessages model={model} />
      {model.props.isMobile
        ? <CareerAccountMobileView model={model} />
        : <CareerAccountDesktopView model={model} />}
      <CareerAccountDialogs model={model} />
    </div>
  );
}

function AccountMessages({ model }: { readonly model: AccountViewModel }) {
  const { notice, error } = model.props;
  return (
    <div className="career-account-messages" aria-live="polite">
      {notice ? <p className="career-account-success" role="status">{notice}</p> : null}
      {error ? <p className="career-expert-error" role="alert">{error}</p> : null}
    </div>
  );
}
