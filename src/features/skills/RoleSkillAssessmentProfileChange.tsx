import { useState } from 'react';
import type { RoleSkillAssessmentRun } from '../../../server/domain/roleSkillAssessment';

export function RoleSkillAssessmentProfileChange({
  change,
  busy,
  onRollback,
}: {
  change: RoleSkillAssessmentRun['profileChange'];
  busy: boolean;
  onRollback: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!change?.acceptedAt) return null;
  if (change.revertedAt) return <RollbackComplete />;
  if (!change.memoryIds.length) return null;
  return (
    <section className="career-role-assessment-card career-role-assessment-profile-change">
      <p>Добавлено в профиль: {change.memoryIds.length} фактов из принятых предложений.</p>
      {confirming ? (
        <RollbackConfirmation
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            if (await onRollback()) setConfirming(false);
          }}
        />
      ) : (
        <button
          className="career-quiet-button"
          type="button"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Отменить добавление в профиль
        </button>
      )}
    </section>
  );
}

function RollbackConfirmation({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="career-role-assessment-profile-change-confirm"
      role="group"
      aria-label="Подтверждение отмены"
    >
      <p>Удалить эти факты из профиля?</p>
      <button className="career-quiet-button" type="button" disabled={busy} onClick={onCancel}>
        Оставить
      </button>
      <button className="career-quiet-button" type="button" disabled={busy} onClick={onConfirm}>
        {busy ? 'Отменяем…' : 'Подтвердить отмену'}
      </button>
    </div>
  );
}

function RollbackComplete() {
  return (
    <p className="career-role-assessment-profile-change is-reverted" role="status">
      Добавление отменено. Принятые в этой проверке факты удалены из профиля.
    </p>
  );
}
