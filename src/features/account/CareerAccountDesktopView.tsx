import { AccountAppSettingsSection, AccountConsentsSection, AccountProfileSection } from './AccountDesktopSections';
import { CandidateBillingAccountSection } from './CandidateBillingAccountSection';
import type { AccountTab, AccountViewModel } from './accountViewTypes';

export function CareerAccountDesktopView({ model }: { readonly model: AccountViewModel }) {
  return (
    <div className="career-account-screen">
      <div className="career-account-head"><h1 className="career-account-title">Аккаунт</h1></div>
      <DesktopAccountTabs model={model} />
      <div
        id="account-tabpanel"
        className="career-account-tabpanel"
        role="tabpanel"
        aria-labelledby={`account-tab-${model.section}`}
        tabIndex={0}
      >
        <DesktopAccountSection model={model} />
      </div>
    </div>
  );
}

function DesktopAccountTabs({ model }: { readonly model: AccountViewModel }) {
  return (
    <div
      ref={model.tabsRef}
      className="career-account-tablist"
      role="tablist"
      aria-label="Аккаунт"
      tabIndex={-1}
      onKeyDown={model.onTabKeyDown}
    >
      {model.tabs.map((tab) => <DesktopAccountTab key={tab.id} tab={tab} model={model} />)}
    </div>
  );
}

function DesktopAccountTab({ tab, model }: { readonly tab: AccountTab; readonly model: AccountViewModel }) {
  return (
    <button
      type="button"
      role="tab"
      data-account-tab={tab.id}
      id={`account-tab-${tab.id}`}
      aria-selected={model.section === tab.id}
      aria-controls="account-tabpanel"
      tabIndex={model.section === tab.id ? 0 : -1}
      className={`career-account-tab-btn${model.section === tab.id ? ' is-active' : ''}`}
      onClick={() => model.onSelectSection(tab.id)}
    >
      {tab.label}
      {tab.id === 'conn' && model.connectionCount !== null ? (
        <span className="career-account-tab-badge">{model.connectionCount}</span>
      ) : null}
    </button>
  );
}

function DesktopAccountSection({ model }: { readonly model: AccountViewModel }) {
  switch (model.section) {
    case 'prof': return <DesktopProfileSection model={model} />;
    case 'conn': return <>{model.connectionsContent}</>;
    case 'notif': return <>{model.notificationsContent}</>;
    case 'cons': return <DesktopConsentsSection model={model} />;
    case 'app': return model.appTabAvailable ? <AccountAppSettingsSection settings={model.appSettings} /> : null;
    case 'pay': return <CandidateBillingAccountSection onOpenTariffs={model.props.onOpenTariffs} />;
  }
}

function DesktopProfileSection({ model }: { readonly model: AccountViewModel }) {
  const { props } = model;
  return (
    <AccountProfileSection
      displayName={model.displayName}
      email={model.email}
      emailVerified={props.user.emailVerified}
      timezone={props.account?.profile.timezone ?? null}
      devices={model.devices}
      busy={props.busy}
      onEditName={() => model.onOpenDialog({ type: 'edit-name' })}
      onEditEmail={() => model.onOpenDialog({ type: 'edit-email' })}
      onChangePassword={() => model.onOpenDialog({ type: 'change-password' })}
      onEditTimezone={() => model.onOpenDialog({ type: 'edit-timezone' })}
      onTerminateDevice={(device) => model.onOpenDialog({ type: 'terminate-session', device })}
      onLogoutOtherDevices={() => model.onOpenDialog({ type: 'terminate-others' })}
      onSignOut={() => model.onOpenDialog({ type: 'sign-out' })}
    />
  );
}

function DesktopConsentsSection({ model }: { readonly model: AccountViewModel }) {
  return (
    <AccountConsentsSection
      consents={model.consents}
      loading={model.consentLoading}
      busy={model.props.busy}
      busyConsentId={model.consentBusyId}
      statusMessage={model.consentStatus}
      onToggleConsent={model.onToggleConsent}
      onExportAll={() => void model.props.actions.exportData()}
      onDeleteAccount={() => model.onOpenDialog({ type: 'delete-account' })}
    />
  );
}
