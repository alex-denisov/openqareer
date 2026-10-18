import { ArrowsClockwise, CheckCircle, Circle, MapTrifold } from '@phosphor-icons/react';
import { ProfileMobileSources } from './ProfileMobileHome';
import { ProfileMobileGroup, ProfileMobileRow } from './ProfileMobileElements';
import {
  profileRelocationSummaryDetail,
  profileRelocationSummaryLabel,
  type ProfileRelocationSummaryStatus,
} from './ProfileSideRail';
import { TopcardEditForm } from './ProfileTopcard';
import { WorkPreferencesRailPanel } from './ProfileSideRail';
import { patchTopcard } from './profileEditing';
import { useProfileEntrySave } from './profileEntrySave';
import type { ProfileMobileDataProps, ProfileMobileNavigationProps } from './profileMobileTypes';

export function ProfileMobileSourceDetails(props: ProfileMobileDataProps) {
  return (
    <>
      <ProfileMobileSources
        importedSources={props.importedSources}
        onSelect={props.onOpenConnections}
        showTitle={false}
      />
      <button
        type="button"
        className="pm-cta is-quiet"
        disabled={!props.onOpenConnections}
        onClick={props.onOpenConnections}
      >
        <ArrowsClockwise size="1em" aria-hidden="true" />
        Импортировать заново
      </button>
    </>
  );
}

function mobileRelocationTitle(status: ProfileRelocationSummaryStatus): string {
  if (status === 'prepared') return 'Релокация подготовлена';
  if (status === 'not_enabled') return 'Релокация не включена';
  return `Релокация: ${profileRelocationSummaryLabel(status).toLocaleLowerCase('ru-RU')}`;
}

export function ProfileMobileRelocation(props: ProfileMobileDataProps) {
  const status = props.relocationSummary ?? 'unknown';
  const enabled = status === 'enabled';
  return (
    <>
      <ProfileMobileGroup>
        <ProfileMobileRow
          icon={enabled ? CheckCircle : Circle}
          title={enabled ? 'Релокация включена' : mobileRelocationTitle(status)}
          detail={enabled ? 'Видите только вы' : profileRelocationSummaryDetail(status)}
          onClick={props.onOpenRelocation}
        />
        <ProfileMobileRow
          icon={MapTrifold}
          title="Страны и условия"
          detail="Данные и условия переезда"
          onClick={props.onOpenRelocation}
        />
      </ProfileMobileGroup>
      <p className="pm-foot">
        Документы, гражданство и сроки хранятся в разделе «Страны и релокация».
      </p>
    </>
  );
}

export function ProfileMobileContacts(
  props: ProfileMobileDataProps & Pick<ProfileMobileNavigationProps, 'back'>,
) {
  const submit = useProfileEntrySave(
    async (patch: Parameters<typeof patchTopcard>[1]) => {
      const result = await props.onSectionSave(patchTopcard(props.draft, patch));
      if (result !== false) props.back();
      return result;
    },
    () => undefined,
  );
  return (
    <>
      <TopcardEditForm
        draft={props.draft}
        saving={props.saving || submit.busy}
        onSave={submit.save}
        onCancel={props.back}
      />
      <WorkPreferencesRailPanel />
      {submit.error ? (
        <p className="career-resume-error" role="alert">
          {submit.error}
        </p>
      ) : null}
    </>
  );
}
