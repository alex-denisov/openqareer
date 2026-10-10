import { useState } from 'react';
import type { CareerDiaryAchievement, CareerDiaryAchievementInput, CareerDiaryAchievementStatus } from '../../../shared/careerDiary';
import { createCareerDiaryAchievement, setCareerDiaryAchievementStatus } from './careerDiaryApi';
import { CareerDiaryAchievementForm } from './CareerDiaryAchievementForm';
import { CareerDiaryAchievementProfileProposal } from './CareerDiaryAchievementProfileProposal';
import { CareerDiaryRecordList } from './CareerDiaryRecordList';
import type { CareerDiaryAchievementProfileStatus } from './careerDiaryAchievementProfile';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';
import type { CareerDiaryRecord } from './useCareerDiaryRecords';

interface CareerDiaryAchievementsProps {
  readonly records: readonly CareerDiaryRecord[];
  readonly state: CareerDiaryLoadState;
  readonly error: string | null;
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly profileStatuses: ReadonlyMap<string, CareerDiaryAchievementProfileStatus>;
  readonly profileStatusesLoading: boolean;
  readonly profileStatusesError: string | null;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
  readonly onRetryProfileStatuses: () => void;
  readonly onRecordsChanged: () => void;
}

export function CareerDiaryAchievements(props: CareerDiaryAchievementsProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [profileAchievement, setProfileAchievement] = useState<CareerDiaryAchievement | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  async function saveAchievement(input: CareerDiaryAchievementInput): Promise<void> {
    await createCareerDiaryAchievement(input);
    setFormOpen(false);
    props.onRecordsChanged();
  }

  async function setAchievementStatus(achievementId: string, status: CareerDiaryAchievementStatus): Promise<void> {
    setStatusError(null);
    try {
      await setCareerDiaryAchievementStatus(achievementId, status);
      props.onRecordsChanged();
    } catch {
      setStatusError('Не удалось обновить достижение. Повторите попытку.');
    }
  }

  if (formOpen) return <CareerDiaryAchievementForm onClose={() => setFormOpen(false)} onSave={saveAchievement} />;
  if (profileAchievement) {
    return <CareerDiaryAchievementProfileProposal
      achievement={profileAchievement}
      onClose={() => setProfileAchievement(null)}
      onPrepared={props.onRetryProfileStatuses}
    />;
  }
  return (
    <CareerDiaryAchievementList
      {...props}
      statusError={statusError}
      onAddMissingAchievement={() => setFormOpen(true)}
      onAddToProfile={setProfileAchievement}
      onSetStatus={(id, status) => void setAchievementStatus(id, status)}
    />
  );
}

interface CareerDiaryAchievementListProps extends Omit<CareerDiaryAchievementsProps, 'onRecordsChanged'> {
  readonly statusError: string | null;
  readonly onAddMissingAchievement: () => void;
  readonly onAddToProfile: (achievement: CareerDiaryAchievement) => void;
  readonly onSetStatus: (id: string, status: CareerDiaryAchievementStatus) => void;
}

function CareerDiaryAchievementList(props: CareerDiaryAchievementListProps) {
  return (
    <div className="career-diary-achievement-workspace">
      {props.profileStatusesError ? (
        <div className="career-diary-error-state" role="alert">
          <p>{props.profileStatusesError}</p>
          <button className="career-btn is-ghost" type="button" onClick={props.onRetryProfileStatuses}>Проверить снова</button>
        </div>
      ) : null}
      {props.statusError ? <p className="career-diary-error" role="alert">{props.statusError}</p> : null}
      <CareerDiaryRecordList
        tab="achievements"
        records={props.records.filter(isAchievement)}
        state={props.state}
        error={props.error}
        nextCursor={props.nextCursor}
        loadingMore={props.loadingMore}
        achievementProfileStatuses={props.profileStatuses}
        profileStatusesLoading={props.profileStatusesLoading || Boolean(props.profileStatusesError)}
        onAddMissingAchievement={props.onAddMissingAchievement}
        onAddToProfile={props.onAddToProfile}
        onSetAchievementStatus={props.onSetStatus}
        onRetry={props.onRetry}
        onLoadMore={props.onLoadMore}
      />
    </div>
  );
}

function isAchievement(record: CareerDiaryRecord): record is CareerDiaryAchievement {
  return 'situation' in record;
}
