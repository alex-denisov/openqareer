import { AdminPermissionsSection } from './AdminPermissionsSection';
import { CareerPartnerAssignments } from './CareerPartnerAssignments';
import type { AdminUser } from './adminApi';

type UserRole = AdminUser['role'];

const USER_ROLE_OPTIONS: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: 'candidate', label: 'Кандидат' },
  { value: 'CareerPartner', label: 'Карьерный консультант' },
  { value: 'admin', label: 'Суперадминистратор' },
];

export function AdminRoleAccessFields({
  userId,
  role,
  savedRole,
  onRoleChange,
  saving,
}: {
  userId: string;
  role: UserRole;
  savedRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  saving: boolean;
}) {
  return (
    <>
      <ProfileRolePicker role={role} onChange={onRoleChange} disabled={saving} />
      <AdminPermissionsSection key={`${userId}:${savedRole}`} userId={userId} />
      {role === 'CareerPartner' && savedRole === 'CareerPartner' && (
        <CareerPartnerAssignments partnerId={userId} />
      )}
      {role === 'CareerPartner' && savedRole !== 'CareerPartner' && (
        <p className="admin-note" role="status">
          Сохраните роль, чтобы закреплять кандидатов.
        </p>
      )}
    </>
  );
}

function ProfileRolePicker({
  role,
  onChange,
  disabled,
}: {
  role: UserRole;
  onChange: (role: UserRole) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="admin-role-picker">
      <legend className="admin-label">Роль в системе</legend>
      <div className="admin-role-picker__options">
        {USER_ROLE_OPTIONS.map((option) => (
          <label className="admin-role-picker__option" key={option.value}>
            <input
              type="radio"
              name="adm-role"
              value={option.value}
              checked={role === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
