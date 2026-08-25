import React, { useState } from 'react';
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
type UserRole = 'candidate' | 'admin';
type TabId = 'profile' | 'subscription' | 'security';

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
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div className="admin-modal-overlay" role="dialog" aria-modal="true" onKeyDown={handleKeyDown}>
      <button type="button" className="admin-modal-backdrop" aria-label="Закрыть" onClick={onClose} tabIndex={-1} />
      <div className="admin-modal admin-modal--large">
        {children}
      </div>
    </div>
  );
}

function ModalTabs({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'profile', label: '👤 Профиль и роль' },
    { id: 'subscription', label: '💳 Подписка и тариф' },
    { id: 'security', label: '🛡️ Безопасность и пароль' },
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
          {t.label}
        </button>
      ))}
    </div>
  );
}

function FeedbackAlerts({ error, successMsg }: { error: string | null; successMsg: string | null }) {
  return (
    <>
      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {successMsg && <div className="admin-alert admin-alert--success">{successMsg}</div>}
    </>
  );
}

// ---------- Profile tab ----------

function ProfileTabForm({
  user, feedback,
}: { user: AdminUser; feedback: FormFeedback }) {
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [email, setEmail] = useState(user.email || '');
  const [headline, setHeadline] = useState(user.headline || '');
  const [location, setLocation] = useState(user.location || '');
  const [workMode, setWorkMode] = useState<WorkMode>((user.workMode as WorkMode) || 'remote');
  const [role, setRole] = useState<UserRole>(user.role);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    feedback.setLoading(true);
    feedback.setError(null);
    feedback.setSuccessMsg(null);
    try {
      await updateAdminUser(user.id, {
        displayName: displayName || null,
        email: email || null,
        headline: headline || null,
        location: location || null,
        workMode: workMode || null,
        role,
      });
      feedback.setSuccessMsg('Профиль успешно обновлен');
    } catch (err) {
      feedback.setError(extractError(err));
    } finally {
      feedback.setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="admin-form">
      <div className="admin-form-grid">
        <ProfileTextInput id="adm-name" label="Отображаемое имя" value={displayName} onChange={setDisplayName} placeholder="Например, Мария Иванова" />
        <ProfileTextInput id="adm-email" label="Email" value={email} onChange={setEmail} placeholder="alex@example.com" type="email" />
        <ProfileSelectInput id="adm-role" label="Роль в системе" value={role} onChange={(v) => setRole(v as UserRole)} options={[['candidate', 'Кандидат (candidate)'], ['admin', 'Администратор (admin)']]} />
        <ProfileSelectInput id="adm-work" label="Формат работы" value={workMode} onChange={(v) => setWorkMode(v as WorkMode)} options={[['remote', 'Удаленно (remote)'], ['hybrid', 'Гибрид (hybrid)'], ['office', 'Офис (office)'], ['flexible', 'Гибкий график (flexible)']]} />
        <ProfileTextInput id="adm-headline" label="Позиция / Headline" value={headline} onChange={setHeadline} placeholder="Senior Product Lead / VP Tech" full />
        <ProfileTextInput id="adm-location" label="Локация" value={location} onChange={setLocation} placeholder="Москва / Белград / Remote" full />
      </div>
      <div className="admin-form-actions">
        <button type="submit" className="admin-btn admin-btn--primary" disabled={feedback.loading}>
          {feedback.loading ? 'Сохранение...' : 'Сохранить изменения'}
        </button>
      </div>
    </form>
  );
}

function ProfileTextInput({ id, label, value, onChange, placeholder, type = 'text', full }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; full?: boolean;
}) {
  return (
    <div className={`admin-form-group${full ? ' admin-form-group--full' : ''}`}>
      <label className="admin-label" htmlFor={id}>{label}</label>
      <input id={id} type={type} className="admin-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function ProfileSelectInput({ id, label, value, onChange, options }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="admin-form-group">
      <label className="admin-label" htmlFor={id}>{label}</label>
      <select id={id} className="admin-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
      </select>
    </div>
  );
}

// ---------- Subscription tab ----------

function SubscriptionTabForm({
  user, feedback,
}: { user: AdminUser; feedback: FormFeedback }) {
  const [tier, setTier] = useState<SubscriptionTier>(user.subscriptionTier || 'free');
  const [status, setStatus] = useState<SubscriptionStatus>(user.subscriptionStatus || 'active');
  const [expires, setExpires] = useState(user.subscriptionExpiresAt ? user.subscriptionExpiresAt.slice(0, 10) : '');
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
        <ProfileSelectInput id="adm-tier" label="Тарифный план (Tier)" value={tier} onChange={(v) => setTier(v as SubscriptionTier)} options={[['free', 'Free (Базовый)'], ['pro', 'Pro (Профессиональный)'], ['executive', 'Executive (Руководящий)'], ['enterprise', 'Enterprise (Корпоративный)']]} />
        <ProfileSelectInput id="adm-sub-status" label="Статус подписки" value={status} onChange={(v) => setStatus(v as SubscriptionStatus)} options={[['active', 'Active (Активна)'], ['trialing', 'Trialing (Пробный период)'], ['past_due', 'Past Due (Требует оплаты)'], ['canceled', 'Canceled (Отменена)']]} />
        <div className="admin-form-group">
          <label className="admin-label" htmlFor="adm-expires">Действует до (Expires At)</label>
          <input id="adm-expires" type="date" className="admin-input" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
        <div className="admin-form-group admin-form-group--full">
          <label className="admin-label" htmlFor="adm-sub-notes">Служебные примечания / Гранты</label>
          <textarea id="adm-sub-notes" className="admin-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Например: Выдан годовой Pro-доступ в рамках партнерства" />
        </div>
      </div>
      <div className="admin-form-actions">
        <button type="submit" className="admin-btn admin-btn--primary" disabled={feedback.loading}>
          {feedback.loading ? 'Сохранение...' : 'Обновить подписку'}
        </button>
      </div>
    </form>
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
        Администратор может принудительно установить новый пароль для пользователя. Все активные сессии будут завершены.
      </p>
      <div className="admin-form-inline">
        <input type="password" className="admin-input" placeholder="Новый пароль (от 8 символов)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <button type="submit" className="admin-btn admin-btn--secondary" disabled={feedback.loading || newPassword.length < 8}>
          Задать пароль
        </button>
      </div>
    </form>
  );
}

function DangerZone({ user, feedback, onClose }: { user: AdminUser; feedback: FormFeedback; onClose: () => void }) {
  const handleToggleBlock = async () => {
    const willBlock = !user.blockedAt;
    const label = willBlock ? 'Заблокировать' : 'Разблокировать';
    if (!window.confirm(`${label} пользователя ${user.username}?`)) return;
    feedback.setLoading(true);
    feedback.setError(null);
    try {
      await blockAdminUser(user.id, willBlock);
      onClose();
    } catch (err) {
      feedback.setError(extractError(err));
      feedback.setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Удалить аккаунт пользователя ${user.username}? Это действие необратимо.`)) return;
    feedback.setLoading(true);
    feedback.setError(null);
    try {
      await deleteAdminUser(user.id);
      onClose();
    } catch (err) {
      feedback.setError(extractError(err));
      feedback.setLoading(false);
    }
  };

  return (
    <div className="admin-danger-zone">
      <h4 className="admin-form-subtitle">Блокировка и удаление</h4>
      <div className="admin-danger-actions">
        <button type="button" className={`admin-btn ${user.blockedAt ? 'admin-btn--secondary' : 'admin-btn--danger'}`} onClick={handleToggleBlock} disabled={feedback.loading}>
          {user.blockedAt ? 'Разблокировать аккаунт' : 'Заблокировать аккаунт'}
        </button>
        <button type="button" className="admin-btn admin-btn--danger-outline" onClick={handleDelete} disabled={feedback.loading}>
          Удалить пользователя
        </button>
      </div>
    </div>
  );
}

function SecurityTabSection({ user, feedback, onClose }: { user: AdminUser; feedback: FormFeedback; onClose: () => void }) {
  return (
    <div className="admin-security-section">
      <PasswordResetForm userId={user.id} feedback={feedback} />
      <hr className="admin-divider" />
      <DangerZone user={user} feedback={feedback} onClose={onClose} />
    </div>
  );
}

// ---------- Footer ----------

function ModalFooter({ user, feedback, onClose }: { user: AdminUser; feedback: FormFeedback; onClose: () => void }) {
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
      <button type="button" className="admin-btn admin-btn--impersonate" onClick={handleImpersonate} disabled={feedback.loading} title="Войти в кабинет кандидата от его имени">
        🚀 Войти как @{user.username} (Имперсонация)
      </button>
      <button type="button" className="admin-btn admin-btn--secondary" onClick={onClose}>
        Закрыть
      </button>
    </div>
  );
}

// ---------- Modal header ----------

function ModalHeader({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  return (
    <div className="admin-modal__header">
      <div className="admin-modal__title-group">
        <h3 className="admin-modal__title">Управление пользователем @{user.username}</h3>
        <span className={`admin-badge admin-badge--${user.role}`}>{user.role}</span>
        {user.blockedAt && <span className="admin-badge admin-badge--blocked">Заблокирован</span>}
      </div>
      <button type="button" className="admin-modal__close" onClick={onClose}>✕</button>
    </div>
  );
}

// ---------- Root export ----------

export function AdminUserProfileModal({ user, onClose, onUpdated }: ModalProps) {
  const [tab, setTab] = useState<TabId>('profile');
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
      <ModalHeader user={user} onClose={onClose} />
      <ModalTabs tab={tab} onChange={handleTabChange} />
      <div className="admin-modal__body">
        <FeedbackAlerts error={feedback.error} successMsg={feedback.successMsg} />
        {tab === 'profile' && <ProfileTabForm user={user} feedback={feedback} />}
        {tab === 'subscription' && <SubscriptionTabForm user={user} feedback={feedback} />}
        {tab === 'security' && <SecurityTabSection user={user} feedback={feedback} onClose={handleCloseWithRefresh} />}
      </div>
      <ModalFooter user={user} feedback={feedback} onClose={onClose} />
    </ModalOverlay>
  );
}
