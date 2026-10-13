import { AccountConfirmDialog } from './AccountDialogs';
import {
  ChangePasswordDialog,
  DeleteAccountDialog,
  EditEmailDialog,
  EditNameDialog,
  TimezoneDialog,
} from './CareerAccountDialogForms';
import { settle } from './accountDialogUtils';
import type { AccountViewModel } from './accountViewTypes';

export function CareerAccountDialogs({ model }: { readonly model: AccountViewModel }) {
  const dialog = model.dialog;
  if (!dialog) return null;
  if (dialog.type === 'terminate-session') return <TerminateSessionDialog model={model} />;
  if (dialog.type === 'terminate-others') return <TerminateOthersDialog model={model} />;
  if (dialog.type === 'consent') return <ConsentDialog model={model} />;
  if (dialog.type === 'delete-account') return <DeleteDialog model={model} />;
  if (dialog.type === 'sign-out') return <SignOutDialog model={model} />;
  if (dialog.type === 'edit-name') return <NameDialog model={model} />;
  if (dialog.type === 'edit-email') return <EmailDialog model={model} />;
  if (dialog.type === 'change-password') return <PasswordDialog model={model} />;
  return <TimezoneEditDialog model={model} />;
}

function TerminateSessionDialog({ model }: { readonly model: AccountViewModel }) {
  const dialog = model.dialog;
  if (dialog?.type !== 'terminate-session') return null;
  const { actions } = model.props;
  return (
    <AccountConfirmDialog
      title="Завершить сессию?"
      description={`Вход на устройстве «${dialog.device.name}» будет завершён.`}
      confirmLabel="Завершить сессию"
      isDanger
      busy={model.props.busy}
      onConfirm={() => void settle(actions.terminateSession(dialog.device.id), model.onCloseDialog, model.onError)}
      onCancel={model.onCloseDialog}
    />
  );
}

function TerminateOthersDialog({ model }: { readonly model: AccountViewModel }) {
  const { actions } = model.props;
  return (
    <AccountConfirmDialog
      title="Выйти на других устройствах?"
      description="Сессии на других устройствах завершатся. Текущая сессия сохранится."
      confirmLabel="Выйти на других устройствах"
      isDanger
      busy={model.props.busy}
      onConfirm={() => void settle(actions.terminateOtherSessions(), model.onCloseDialog, model.onError)}
      onCancel={model.onCloseDialog}
    />
  );
}

function ConsentDialog({ model }: { readonly model: AccountViewModel }) {
  const dialog = model.dialog;
  if (dialog?.type !== 'consent') return null;
  const revoking = dialog.consent.status === 'granted';
  return (
    <AccountConfirmDialog
      title={revoking ? 'Отозвать согласие?' : 'Дать согласие?'}
      description={`«${dialog.consent.title}». ${dialog.consent.consequences}`}
      confirmLabel={revoking ? 'Отозвать согласие' : 'Дать согласие'}
      isDanger={revoking}
      busy={model.props.busy}
      onConfirm={() => void model.onConfirmConsent(dialog.consent)}
      onCancel={model.onCloseDialog}
    />
  );
}

function DeleteDialog({ model }: { readonly model: AccountViewModel }) {
  return (
    <DeleteAccountDialog
      busy={model.props.busy}
      error={model.dialogError}
      onError={model.onError}
      onClose={model.onCloseDialog}
      onDelete={model.props.actions.deleteAccount}
    />
  );
}

function SignOutDialog({ model }: { readonly model: AccountViewModel }) {
  return (
    <AccountConfirmDialog
      title="Выйти из аккаунта?"
      description="Текущая сессия на этом устройстве завершится."
      confirmLabel="Выйти из аккаунта"
      busy={model.props.busy}
      onConfirm={() => void settle(model.props.actions.signOut(), model.onCloseDialog, model.onError)}
      onCancel={model.onCloseDialog}
    />
  );
}

function NameDialog({ model }: { readonly model: AccountViewModel }) {
  return (
    <EditNameDialog
      value={model.props.account?.displayName ?? model.props.user.displayName ?? ''}
      busy={model.props.busy}
      error={model.dialogError}
      onError={model.onError}
      onClose={model.onCloseDialog}
      onSave={model.props.actions.saveDisplayName}
    />
  );
}

function EmailDialog({ model }: { readonly model: AccountViewModel }) {
  return (
    <EditEmailDialog
      email={model.props.account?.email ?? model.props.user.email ?? ''}
      pending={model.props.pendingEmailChange}
      busy={model.props.busy}
      error={model.dialogError}
      onError={model.onError}
      onClose={model.onCloseDialog}
      onRequest={model.props.actions.requestEmailChange}
      onVerify={model.props.actions.verifyEmailChange}
    />
  );
}

function PasswordDialog({ model }: { readonly model: AccountViewModel }) {
  return (
    <ChangePasswordDialog
      busy={model.props.busy}
      error={model.dialogError}
      onError={model.onError}
      onClose={model.onCloseDialog}
      onSave={model.props.actions.changePassword}
    />
  );
}

function TimezoneEditDialog({ model }: { readonly model: AccountViewModel }) {
  return (
    <TimezoneDialog
      value={model.props.account?.profile.timezone ?? ''}
      busy={model.props.busy}
      error={model.dialogError}
      onError={model.onError}
      onClose={model.onCloseDialog}
      onSave={model.props.actions.saveTimezone}
    />
  );
}
