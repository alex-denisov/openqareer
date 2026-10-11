import { useState } from 'react';
import { useCareerDiaryAccess } from './careerDiaryAccess';
import type { CareerDiaryWorkplace, CareerDiaryWorkplaceInput } from '../../../shared/careerDiary';
import type { CareerDiaryProfileExperience } from './careerDiaryAccess';
import {
  CareerDiaryPrimaryPlaceDialog,
  CareerDiaryProfileSetupDialog,
  CareerDiaryRoleChangeDialog,
} from './CareerDiaryAccessDialogs';
import type { CareerDiaryRoleChangeDialogProps } from './CareerDiaryAccessDialogs';
import './careerDiaryAccess.css';

export function CareerDiaryShellControls({
  onDataChanged,
}: {
  readonly onDataChanged: () => void;
}) {
  const access = useCareerDiaryAccess();
  if (!access.isVisible) return null;
  const primaryWorkplace = access.primaryWorkplace;
  if (!primaryWorkplace) {
    return (
      <CareerDiaryProfileSetupControl
        experiences={access.profileExperiences}
        saving={access.saving}
        error={access.mutationError}
        onCreate={access.createDiaryFromProfile}
        onDataChanged={onDataChanged}
      />
    );
  }
  return (
    <CareerDiaryCurrentWorkplaceControls
      access={access}
      primaryWorkplace={primaryWorkplace}
      onDataChanged={onDataChanged}
    />
  );
}

function CareerDiaryCurrentWorkplaceControls({
  access,
  primaryWorkplace,
  onDataChanged,
}: {
  readonly access: ReturnType<typeof useCareerDiaryAccess>;
  readonly primaryWorkplace: CareerDiaryWorkplace;
  readonly onDataChanged: () => void;
}) {
  const activePlaces = access.workplaces.filter((workplace) => workplace.status === 'active');
  return (
    <div className="career-diary-shell-controls">
      <CareerDiaryPrimaryWorkplaceLabel workplace={primaryWorkplace} />
      {activePlaces.length > 1 ? (
        <CareerDiaryPrimaryPlaceControl
          workplaces={activePlaces}
          currentId={primaryWorkplace.id}
          saving={access.saving}
          error={access.mutationError}
          onSave={async (workplaceId) => {
            const saved = await access.setPrimaryWorkplace(workplaceId);
            if (saved) onDataChanged();
            return saved;
          }}
        />
      ) : null}
      {access.profileRoleChange ? (
        <CareerDiaryRoleChangeControl
          onDataChanged={onDataChanged}
          currentWorkplace={primaryWorkplace}
          profileRole={access.profileRoleChange}
          saving={access.saving}
          error={access.mutationError}
          onClose={access.dismissRoleChange}
          onKeepCurrent={access.updateCurrentDiaryRole}
          onStartNew={access.startNewDiary}
        />
      ) : null}
    </div>
  );
}

function CareerDiaryProfileSetupControl({
  experiences,
  saving,
  error,
  onCreate,
  onDataChanged,
}: {
  readonly experiences: readonly CareerDiaryProfileExperience[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly onCreate: (input: CareerDiaryWorkplaceInput) => Promise<boolean>;
  readonly onDataChanged: () => void;
}) {
  const current = experiences.filter((experience) => experience.current && !experience.endDate);
  const [open, setOpen] = useState(false);
  if (!current.length) return null;
  return (
    <div className="career-diary-shell-controls">
      <p>В профиле есть текущее место работы. Создайте по нему дневник.</p>
      <button
        className="career-btn is-primary"
        type="button"
        disabled={saving}
        onClick={() => setOpen(true)}
      >
        Создать дневник
      </button>
      {open ? (
        <CareerDiaryProfileSetupDialog
          experiences={current}
          saving={saving}
          error={error}
          onClose={() => setOpen(false)}
          onCreate={async (input) => {
            const saved = await onCreate(input);
            if (saved) {
              setOpen(false);
              onDataChanged();
            }
            return saved;
          }}
        />
      ) : null}
    </div>
  );
}

function CareerDiaryPrimaryWorkplaceLabel({
  workplace,
}: {
  readonly workplace: CareerDiaryWorkplace;
}) {
  return (
    <p>
      Место дневника: <strong>{workplace.company}</strong> · {workplace.title}
    </p>
  );
}

function CareerDiaryRoleChangeControl({
  onDataChanged,
  ...props
}: CareerDiaryRoleChangeDialogProps & { readonly onDataChanged: () => void }) {
  return (
    <CareerDiaryRoleChangeDialog
      {...props}
      onKeepCurrent={async () => {
        const saved = await props.onKeepCurrent();
        if (saved) onDataChanged();
        return saved;
      }}
      onStartNew={async (startDate) => {
        const saved = await props.onStartNew(startDate);
        if (saved) onDataChanged();
        return saved;
      }}
    />
  );
}

function CareerDiaryPrimaryPlaceControl({
  workplaces,
  currentId,
  saving,
  error,
  onSave,
}: {
  readonly workplaces: readonly CareerDiaryWorkplace[];
  readonly currentId: string;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onSave: (workplaceId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="career-btn is-ghost" type="button" onClick={() => setOpen(true)}>
        Сменить основное место
      </button>
      {open ? (
        <CareerDiaryPrimaryPlaceDialog
          workplaces={workplaces}
          currentId={currentId}
          saving={saving}
          error={error}
          onClose={() => setOpen(false)}
          onSave={async (workplaceId) => {
            const saved = await onSave(workplaceId);
            if (saved) setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function CareerDiaryAccessStatus() {
  const access = useCareerDiaryAccess();
  if (access.state === 'loading') {
    return (
      <p className="career-diary-access-status" role="status" aria-busy="true">
        Проверяем место работы из профиля…
      </p>
    );
  }
  if (access.state === 'error') {
    return (
      <section className="career-diary-access-error" role="alert">
        <p>{access.error ?? 'Не удалось проверить место работы.'}</p>
        <button className="career-btn is-ghost" type="button" onClick={access.reload}>
          Повторить
        </button>
      </section>
    );
  }
  return null;
}
