import { CandidateBillingAccountSection } from './CandidateBillingAccountSection';
import {
  MobileAccountConsents,
  MobileAccountDevices,
  MobileAccountHome,
  MobileAccountProfile,
} from './AccountMobileSections';
import type { MobileAccountViewId } from './accountTypes';
import type { AccountViewModel } from './accountViewTypes';

export function CareerAccountMobileView({ model }: { readonly model: AccountViewModel }) {
  const view = normalizeMobileView(model.mobileView);
  if (view === 'conn') return <>{model.connectionsContent}</>;
  if (view === 'notif' || view.startsWith('ev')) return <MobileNotificationsView model={model} />;
  if (view === 'cons') return <MobileConsentsView model={model} />;
  if (view === 'pay') return <MobileSubscriptionView model={model} />;
  if (view === 'dev') return <MobileDevicesView model={model} />;
  if (view === 'prof') return <MobileProfileView model={model} />;
  return <MobileHomeView model={model} />;
}

function normalizeMobileView(view: MobileAccountViewId): MobileAccountViewId {
  return view === 'li' || view === 'hh' ? 'conn' : view;
}

function MobileNotificationsView({ model }: { readonly model: AccountViewModel }) {
  return <div className="career-account-mobile-view">{model.notificationsContent}</div>;
}

function MobileConsentsView({ model }: { readonly model: AccountViewModel }) {
  return (
    <MobileAccountConsents
      consents={model.consents}
      loading={model.consentLoading}
      busyConsentId={model.consentBusyId}
      statusMessage={model.consentStatus}
      onBack={() => model.onGoView('home')}
      onToggleConsent={model.onToggleConsent}
      onExportAll={() => void model.props.actions.exportData()}
      onDeleteAccount={() => model.onOpenDialog({ type: 'delete-account' })}
    />
  );
}

function MobileSubscriptionView({ model }: { readonly model: AccountViewModel }) {
  return (
    <div className="career-account-mobile-view" data-mv="pay">
      <div className="career-account-mobile-header">
        <button type="button" className="career-account-mobile-back-btn" aria-label="Назад" onClick={() => model.onGoView('home')}>
          <span aria-hidden="true">‹</span>
        </button>
        <h2 className="career-account-title">Подписка и платежи</h2>
      </div>
      <CandidateBillingAccountSection onOpenTariffs={model.props.onOpenTariffs} />
    </div>
  );
}

function MobileDevicesView({ model }: { readonly model: AccountViewModel }) {
  return (
    <MobileAccountDevices
      devices={model.devices}
      busy={model.props.busy}
      onBack={() => model.onGoView('prof')}
      onTerminateDevice={(device) => model.onOpenDialog({ type: 'terminate-session', device })}
      onLogoutOtherDevices={() => model.onOpenDialog({ type: 'terminate-others' })}
    />
  );
}

function MobileProfileView({ model }: { readonly model: AccountViewModel }) {
  return (
    <MobileAccountProfile
      displayName={model.displayName}
      email={model.email}
      emailVerified={model.props.user.emailVerified}
      timezone={model.props.account?.profile.timezone ?? null}
      onBack={() => model.onGoView('home')}
      onGoDevices={() => model.onGoView('dev')}
      onEditName={() => model.onOpenDialog({ type: 'edit-name' })}
      onEditEmail={() => model.onOpenDialog({ type: 'edit-email' })}
      onChangePassword={() => model.onOpenDialog({ type: 'change-password' })}
      onEditTimezone={() => model.onOpenDialog({ type: 'edit-timezone' })}
      onSignOut={() => model.onOpenDialog({ type: 'sign-out' })}
    />
  );
}

function MobileHomeView({ model }: { readonly model: AccountViewModel }) {
  return (
    <MobileAccountHome
      displayName={model.displayName}
      email={model.email}
      onGoView={model.onGoView}
      onSignOut={() => model.onOpenDialog({ type: 'sign-out' })}
    />
  );
}
