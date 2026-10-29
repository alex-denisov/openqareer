import { ArrowsClockwise, CheckCircle, Circle, MapTrifold } from '@phosphor-icons/react';
import { linkedinStageLabel } from '../connections/linkedinImportProgress';
import { PLATFORM_LABELS } from '../connections/platformLabels';
import { importSummary } from './ProfileSourceDialog';
import { walkReadCount } from './profileProvenance';
import { ProfileMobileSources } from './ProfileMobileHome';
import { ProfileMobileGroup, ProfileMobileRow } from './ProfileMobileElements';
import {
  profileRelocationSummaryDetail,
  profileRelocationSummaryLabel,
  type ProfileRelocationSummaryStatus,
  WorkPreferencesRailPanel,
} from './ProfileSideRail';
import { TopcardEditForm } from './ProfileTopcard';
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
      <ProfileMobileImportParams
        importedSources={props.importedSources}
        onRetry={props.onOpenConnections}
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

/** C6, 390: import parameters and unread sections, the same facts as the desktop source window. */
export function ProfileMobileImportParams({
  importedSources,
  onRetry,
}: Pick<ProfileMobileDataProps, 'importedSources'> & { readonly onRetry?: () => void }) {
  return (
    <>
      {(importedSources ?? []).map((source) => {
        const walk = source.walk && source.walk.state === 'done' ? source.walk : undefined;
        const failed = walk?.sections.filter((section) => section.status === 'failed') ?? [];
        return (
          <ProfileMobileGroup key={source.platform} title={PLATFORM_LABELS[source.platform]}>
            <p className="pm-foot">
              {importSummary(source.factCount, source.lastImportedAt, source.keptFactCount)}
            </p>
            {walk ? (
              <p className="pm-foot">
                Прочитано разделов: {walkReadCount(walk)} из {walk.sections.length}
              </p>
            ) : null}
            {failed.map((section) => (
              <ProfileMobileRow
                key={section.key}
                icon={ArrowsClockwise}
                title={`Раздел «${linkedinStageLabel(section.key)}» не прочитан`}
                detail="Повторить раздел"
                onClick={onRetry}
              />
            ))}
          </ProfileMobileGroup>
        );
      })}
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
      <details className="career-profile-screen-relocation-prefs">
        <summary>Ограничения и предпочтения для подбора</summary>
        <WorkPreferencesRailPanel />
      </details>
    </>
  );
}

export function ProfileMobileContacts(
  props: ProfileMobileDataProps &
    Pick<ProfileMobileNavigationProps, 'back'> & {
      /** After a successful save: the dialog closes whole instead of going back to its menu. */
      readonly onSaved?: () => void;
    },
) {
  const submit = useProfileEntrySave(
    async (patch: Parameters<typeof patchTopcard>[1]) => {
      const result = await props.onSectionSave(patchTopcard(props.draft, patch));
      if (result === false) return result;
      if (props.onSaved) props.onSaved();
      else props.back();
      return result;
    },
    () => undefined,
  );
  return (
    <TopcardEditForm
      draft={props.draft}
      saving={props.saving || submit.busy}
      error={submit.error}
      onSave={submit.save}
      onCancel={props.back}
    />
  );
}
