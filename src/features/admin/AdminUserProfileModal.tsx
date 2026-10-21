import React, { useState } from 'react';
import { useEscapeLayer } from '../shell/escapeLayers';
import { AdminRoleAccessFields } from './AdminRoleAccessFields';
import { CreditCard, ShieldCheck, SignIn, UserCircle, type Icon } from '@phosphor-icons/react';
import {
  updateAdminUser,
  blockAdminUser,
  resetAdminUserPassword,
  impersonateAdminUser,
  deleteAdminUser,
  type AdminUser,
  type SubscriptionTier,
  type SubscriptionStatus,
} from './adminApi';

type WorkMode = 'office' | 'hybrid' | 'remote' | 'flexible';
type UserRole = AdminUser['role'];
type TabId = 'profile' | 'subscription' | 'security';

const USER_ROLE_OPTIONS: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: 'candidate', label: 'Кандидат' },
  { value: 'CareerPartner', label: 'Карьерный консультант' },
  { value: 'admin', label: 'Суперадминистратор' },
];

interface ModalProps {
  user: AdminUser;
  onClose: () => void;
  onUpdated: () => void;
}

interface FormFeedback {
  error: string | null;
  successMsg: string | null;
  loading: boolean;
  setError: (v: string | null) => void;
  setSuccessMsg: (v: string | null) => void;
  setLoading: (v: boolean) => void;
}

function useFormFeedback(): FormFeedback {
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  return { error, successMsg, loading, setError, setSuccessMsg, setLoading };
}

function extractError(err: unknown): string {
  return err instanceof Error ? err.message : 'Неизвестная ошибка';
}

// ---------- Modal shell ----------

function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEscapeLayer(onClose);
  return (
    <div className="admin-modal-overlay" role="dialog" aria-modal="true">
      <button
        type="button"
        className="admin-modal-backdrop"
        aria-label="Закрыть"
        onClick={onClose}
        tabIndex={-1}
      />
      <div className="admin-modal admin-modal--large">{children}</div>
    </div>
  );
}

function ModalTabs({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  const tabs: Array<{ id: TabId; label: string; Icon: Icon }> = [
    { id: 'profile', label: 'Профиль и роль', Icon: UserCircle },
    { id: 'subscription', label: 'Подписка и тариф', Icon: CreditCard },
    { id: 'security', label: 'Безопасность и пароль', Icon: ShieldCheck },
  ];
  return (
    <div className="admin-modal__tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`admin-modal__tab ${tab === t.id ? 'admin-modal__tab--active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <t.Icon size={14} aria-hidden="true" /> {t.label}
        </button>
      ))}
    </div>
  );
}

function FeedbackAlerts({
  error,
  successMsg,
}: {
  error: string | null;
  successMsg: string | null;
}) {
  return (
    <>
      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {successMsg && <div className="admin-alert admin-alert--success">{successMsg}</div>}
    </>
  );
}

// ---------- Profile tab ----------

interface ProfileValues {
  displayName: string;
  email: string;
  headline: string;
  location: string;
  workMode: WorkMode;
}

function ProfileTabForm({
  user,
  feedback,
  onRoleSaved,
}: {
  user: AdminUser;
  feedback: FormFeedback;
  onRoleSaved: (role: UserRole) => void;
}) {
  const [values, setValues] = useState<ProfileValues>({
    displayName: user.displayName || '',
    email: user.email || '',
    headline: user.headline || '',
    location: user.location || '',
    workMode: (user.workMode as WorkMode) || 'remote',
  });
  const [role, setRole] = useState<UserRole>(user.role);
  const [savedRole, setSavedRole] = useState<UserRole>(user.role);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    feedback.setLoading(true);
    feedback.setError(null);
    feedback.setSuccessMsg(null);
    try {
      const updated = await updateAdminUser(user.id, profileUpdate(values, role));
      setSavedRole(updated.role);
      onRoleSaved(updated.role);
      feedback.setSuccessMsg('Профиль сохранён.');
    } catch (err) {
      feedback.setError(extractError(err));
    } finally {
      feedback.setLoading(false);
    }
  };

  return (
    <ProfileEditor
      userId={user.id}
      values={values}
      onValues={setValues}
      role={role}
      savedRole={savedRole}
      onRole={setRole}
      saving={feedback.loading}
      onSubmit={submit}
    />
  );
}

function profileUpdate(values: ProfileValues, role: UserRole) {
  return {
    displayName: values.displayName || null,
    email: values.email || null,
    headline: values.headline || null,
    location: values.location || null,
    workMode: values.workMode || null,
    role,
  };
}

function ProfileEditor({
  userId,
  values,
  onValues,
  role,
  savedRole,
  onRole,
  saving,
  onSubmit,
}: {
  userId: string;
  values: ProfileValues;
  onValues: (values: ProfileValues) => void;
  role: UserRole;
  savedRole: UserRole;
  onRole: (role: UserRole) => void;
  saving: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="admin-form">
      <ProfileDetailsFields values={values} onValues={onValues} />
      <AdminRoleAccessFields
        userId={userId}
        role={role}
        savedRole={savedRole}
        onRoleChange={onRole}
        saving={saving}
      />
      <div className="admin-form-actions">
        <button type="submit" className="admin-btn admin-btn--primary" disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить изменения'}
        </button>
      </div>
    </form>
  );
}

function ProfileDetailsFields({
  values,
  onValues,
}: {
  values: ProfileValues;
  onValues: (values: ProfileValues) => void;
}) {
  return (
    <div className="admin-form-grid">
      <ProfileIdentityFields values={values} onValues={onValues} />
      <ProfileTargetFields values={values} onValues={onValues} />
    </div>
  );
}

function updateProfileValue(
  values: ProfileValues,
  onValues: (values: ProfileValues) => void,
  field: keyof ProfileValues,
  value: string,
): void {
  onValues({ ...values, [field]: value } as ProfileValues);
}

function ProfileIdentityFields({
  values,
  onValues,
}: {
  values: ProfileValues;
  onValues: (values: ProfileValues) => void;
}) {
  return (
    <>
      <ProfileTextInput
        id="adm-name"
        label="Отображаемое имя"
        value={values.displayName}
        onChange={(value) => updateProfileValue(values, onValues, 'displayName', value)}
        placeholder="Например, Мария Иванова"
      />
      <ProfileTextInput
        id="adm-email"
        label="Email"
        value={values.email}
        onChange={(value) => updateProfileValue(values, onValues, 'email', value)}
        placeholder="alex@example.com"
        type="email"
      />
    </>
  );
}

function ProfileTargetFields({
  values,
  onValues,
}: {
  values: ProfileValues;
  onValues: (values: ProfileValues) => void;
}) {
  return (
    <>
      <ProfileSelectInput
        id="adm-work"
        label="Формат работы"
        value={values.workMode}
        onChange={(value) => updateProfileValue(values, onValues, 'workMode', value)}
        options={[
          ['remote', 'Удалённо'],
          ['hybrid', 'Гибрид'],
          ['office', 'Офис'],
          ['flexible', 'Гибкий график'],
        ]}
      />
      <ProfileTextInput
        id="adm-headline"
        label="Позиция"
        value={values.headline}
        onChange={(value) => updateProfileValue(values, onValues, 'headline', value)}
        placeholder="Роль или специализация"
        full
      />
      <ProfileTextInput
        id="adm-location"
        label="Локация"
        value={values.location}
        onChange={(value) => updateProfileValue(values, onValues, 'location', value)}
        placeholder="Город или регион"
        full
      />
    </>
  );
}

function ProfileTextInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  full,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  full?: boolean;
}) {
  return (
    <div className={`admin-form-group${full ? ' admin-form-group--full' : ''}`}>
      <label className="admin-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="admin-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function ProfileSelectInput({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="admin-form-group">
      <label className="admin-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="admin-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([val, text]) => (
          <option key={val} value={val}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------- Subscription tab ----------

function SubscriptionTabForm({ user, feedback }: { user: AdminUser; feedback: FormFeedback }) {
  const [tier, setTier] = useState<SubscriptionTier>(user.subscriptionTier || 'free');
  const [status, setStatus] = useState<SubscriptionStatus>(user.subscriptionStatus || 'active');
  const [expires, setExpires] = useState(
    user.subscriptionExpiresAt ? user.subscriptionExpiresAt.slice(0, 10) : '',
  );
  const [notes, setNotes] = useState(user.subscriptionNotes || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    feedback.setLoading(true);
    feedback.setError(null);
    feedback.setSuccessMsg(null);
    try {
      await updateAdminUser(user.id, {
        subscriptionTier: tier,
        subscriptionStatus: status,
        subscriptionExpiresAt: expires ? new Date(expires).toISOString() : null,
        subscriptionNotes: notes || null,
      });
      feedback.setSuccessMsg('Параметры подписки сохранены');
    } catch (err) {
      feedback.setError(extractError(err));
    } finally {
      feedback.setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="admin-form">
      <div className="admin-form-grid">
        <SubscriptionPlanFields tier={tier} status={status} onTier={setTier} onStatus={setStatus} />
        <SubscriptionDatesFields
          expires={expires}
          notes={notes}
          onExpires={setExpires}
          onNotes={setNotes}
        />
      </div>
      <div className="admin-form-actions">
        <button type="submit" className="admin-btn admin-btn--primary" disabled={feedback.loading}>
          {feedback.loading ? 'Сохранение...' : 'Обновить подписку'}
        </button>
      </div>
    </form>
  );
}

function SubscriptionPlanFields({
  tier,
  status,
  onTier,
  onStatus,
}: {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  onTier: (value: SubscriptionTier) => void;
  onStatus: (value: SubscriptionStatus) => void;
}) {
  return (
    <>
      <ProfileSelectInput
        id="adm-tier"
        label="Тарифный план (Tier)"
        value={tier}
        onChange={(value) => onTier(value as SubscriptionTier)}
        options={[
          ['free', 'Free (Базовый)'],
          ['pro', 'Pro (Профессиональный)'],
          ['executive', 'Executive (Руководящий)'],
          ['enterprise', 'Enterprise (Корпоративный)'],
        ]}
      />
      <ProfileSelectInput
        id="adm-sub-status"
        label="Статус подписки"
        value={status}
        onChange={(value) => onStatus(value as SubscriptionStatus)}
        options={[
          ['active', 'Active (Активна)'],
          ['trialing', 'Trialing (Пробный период)'],
          ['past_due', 'Past Due (Требует оплаты)'],
          ['canceled', 'Canceled (Отменена)'],
        ]}
      />
    </>
  );
}

function SubscriptionDatesFields({
  expires,
  notes,
  onExpires,
  onNotes,
}: {
  expires: string;
  notes: string;
  onExpires: (value: string) => void;
  onNotes: (value: string) => void;
}) {
  return (
    <>
      <div className="admin-form-group">
        <label className="admin-label" htmlFor="adm-expires">
          Действует до (Expires At)
        </label>
        <input
          id="adm-expires"
          type="date"
          className="admin-input"
          value={expires}
          onChange={(event) => onExpires(event.target.value)}
        />
      </div>
      <div className="admin-form-group admin-form-group--full">
        <label className="admin-label" htmlFor="adm-sub-notes">
          Служебные примечания / Гранты
        </label>
        <textarea
          id="adm-sub-notes"
          className="admin-textarea"
          rows={3}
          value={notes}
          onChange={(event) => onNotes(event.target.value)}
          placeholder="Например: Выдан годовой Pro-доступ в рамках партнерства"
        />
      </div>
    </>
  );
}

// ---------- Security tab ----------

function PasswordResetForm({ userId, feedback }: { userId: string; feedback: FormFeedback }) {
  const [newPassword, setNewPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      feedback.setError('Пароль должен содержать не менее 8 символов');
      return;
    }
    feedback.setLoading(true);
    feedback.setError(null);
    feedback.setSuccessMsg(null);
    try {
      await resetAdminUserPassword(userId, newPassword);
      feedback.setSuccessMsg('Пароль успешно изменен. Активные сессии пользователя отозваны.');
      setNewPassword('');
    } catch (err) {
      feedback.setError(extractError(err));
    } finally {
      feedback.setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="admin-form">
      <h4 className="admin-form-subtitle">Сброс пароля</h4>
      <p className="admin-form-desc">
        Администратор может принудительно установить новый пароль для пользователя. Все активные
        сессии будут завершены.
      </p>
      <div className="admin-form-inline">
        <input
          type="password"
          className="admin-input"
          placeholder="Новый пароль (от 8 символов)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <button
          type="submit"
          className="admin-btn admin-btn--secondary"
          disabled={feedback.loading || newPassword.length < 8}
        >
          Задать пароль
        </button>
      </div>
    </form>
  );
}

function DangerZone({
  user,
  feedback,
  onClose,
}: {
  user: AdminUser;
  feedback: FormFeedback;
  onClose: () => void;
}) {
  const willBlock = !user.blockedAt;
  const blockLabel = willBlock ? 'Заблокировать' : 'Разблокировать';
  const handleToggleBlock = () =>
    runAdminDangerAction(`${blockLabel} пользователя ${user.username}?`, feedback, onClose, () =>
      blockAdminUser(user.id, willBlock),
    );
  const handleDelete = () =>
    runAdminDangerAction(
      `Удалить аккаунт пользователя ${user.username}? Это действие необратимо.`,
      feedback,
      onClose,
      () => deleteAdminUser(user.id),
    );

  return (
    <div className="admin-danger-zone">
      <h4 className="admin-form-subtitle">Блокировка и удаление</h4>
      <div className="admin-danger-actions">
        <button
          type="button"
          className={`admin-btn ${user.blockedAt ? 'admin-btn--secondary' : 'admin-btn--danger'}`}
          onClick={handleToggleBlock}
          disabled={feedback.loading}
        >
          {user.blockedAt ? 'Разблокировать аккаунт' : 'Заблокировать аккаунт'}
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--danger-outline"
          onClick={handleDelete}
          disabled={feedback.loading}
        >
          Удалить пользователя
        </button>
      </div>
    </div>
  );
}

async function runAdminDangerAction(
  confirmation: string,
  feedback: FormFeedback,
  onClose: () => void,
  action: () => Promise<unknown>,
): Promise<void> {
  if (!window.confirm(confirmation)) return;
  feedback.setLoading(true);
  feedback.setError(null);
  try {
    await action();
    onClose();
  } catch (reason: unknown) {
    feedback.setError(extractError(reason));
    feedback.setLoading(false);
  }
}

function SecurityTabSection({
  user,
  feedback,
  onClose,
}: {
  user: AdminUser;
  feedback: FormFeedback;
  onClose: () => void;
}) {
  return (
    <div className="admin-security-section">
      <PasswordResetForm userId={user.id} feedback={feedback} />
      <hr className="admin-divider" />
      <DangerZone user={user} feedback={feedback} onClose={onClose} />
    </div>
  );
}

// ---------- Footer ----------

function ModalFooter({
  user,
  feedback,
  onClose,
}: {
  user: AdminUser;
  feedback: FormFeedback;
  onClose: () => void;
}) {
  const handleImpersonate = async () => {
    if (!window.confirm(`Войти в личный кабинет под именем @${user.username}?`)) return;
    feedback.setLoading(true);
    feedback.setError(null);
    try {
      const res = await impersonateAdminUser(user.id);
      window.location.href = res.redirectUrl || '/app';
    } catch (err) {
      feedback.setError(extractError(err));
      feedback.setLoading(false);
    }
  };

  return (
    <div className="admin-modal__footer">
      <button
        type="button"
        className="admin-btn admin-btn--impersonate"
        onClick={handleImpersonate}
        disabled={feedback.loading}
        title="Войти в кабинет кандидата от его имени"
      >
        <SignIn size={16} aria-hidden="true" /> Войти как @{user.username} (Имперсонация)
      </button>
      <button type="button" className="admin-btn admin-btn--secondary" onClick={onClose}>
        Закрыть
      </button>
    </div>
  );
}

// ---------- Modal header ----------

function ModalHeader({
  user,
  role,
  onClose,
}: {
  user: AdminUser;
  role: UserRole;
  onClose: () => void;
}) {
  return (
    <div className="admin-modal__header">
      <div className="admin-modal__title-group">
        <h3 className="admin-modal__title">Управление пользователем @{user.username}</h3>
        <span className={`admin-badge admin-badge--${user.role}`}>
          {USER_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role}
        </span>
        {user.blockedAt && <span className="admin-badge admin-badge--blocked">Заблокирован</span>}
      </div>
      <button type="button" className="admin-modal__close" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

// ---------- Root export ----------

export function AdminUserProfileModal({ user, onClose, onUpdated }: ModalProps) {
  const [tab, setTab] = useState<TabId>('profile');
  const [role, setRole] = useState<UserRole>(user.role);
  const feedback = useFormFeedback();

  const handleTabChange = (t: TabId) => {
    setTab(t);
    feedback.setError(null);
    feedback.setSuccessMsg(null);
  };

  const handleCloseWithRefresh = () => {
    onUpdated();
    onClose();
  };

  return (
    <ModalOverlay onClose={onClose}>
      <ModalHeader user={user} role={role} onClose={onClose} />
      <ModalTabs tab={tab} onChange={handleTabChange} />
      <div className="admin-modal__body">
        <FeedbackAlerts error={feedback.error} successMsg={feedback.successMsg} />
        {tab === 'profile' && (
          <ProfileTabForm user={user} feedback={feedback} onRoleSaved={setRole} />
        )}
        {tab === 'subscription' && <SubscriptionTabForm user={user} feedback={feedback} />}
        {tab === 'security' && (
          <SecurityTabSection user={user} feedback={feedback} onClose={handleCloseWithRefresh} />
        )}
      </div>
      <ModalFooter user={user} feedback={feedback} onClose={onClose} />
    </ModalOverlay>
  );
}
