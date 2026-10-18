import { useRef, useState } from 'react';
import { Briefcase, PencilSimple, Plus } from '@phosphor-icons/react';
import { ProfileMobilePositionEditor } from './ProfileMobilePositionEditor';
import {
  ExperienceSuggestionsList,
  ExperienceVacancyRequirement,
  periodLabel,
  responsibilityBullets,
} from './ProfileExperienceSection';
import { addExperience, updateExperience } from './resumeStudioModel';
import {
  ProfileMobileGroup,
  ProfileMobileKeyValue,
  ProfileMobileRow,
  profileMobileDate,
} from './ProfileMobileElements';
import type { ProfileMobileDataProps, ProfileMobileNavigationProps } from './profileMobileTypes';
import type { ProfileMobileRoute } from './profileMobileNavigation';
import type { ResumeExperienceInput } from './resumeTypes';

interface ExperienceProps extends ProfileMobileDataProps, ProfileMobileNavigationProps {
  readonly route: ProfileMobileRoute;
}

/** The list says «с 03.2021» for the current place; the place page keeps «— по н. в.». */
function listPeriod(entry: Parameters<typeof periodLabel>[0]): string {
  const period = periodLabel(entry);
  return entry.current ? period.replace(/^(.+) — по н\. в\.$/u, 'с $1') : period;
}

export function ProfileMobileExperienceList(props: ExperienceProps) {
  const entries = [...props.draft.experience].sort((left, right) =>
    (right.startDate ?? '').localeCompare(left.startDate ?? ''),
  );
  return (
    <>
      <ExperienceVacancyRequirement props={props} />
      <ExperienceSuggestionsList {...props} />
      <ProfileMobileGroup foot="Места по дате начала, новые сверху. У каждого факта есть источник.">
        {entries.map((entry) => (
          <ProfileMobileRow
            key={entry.id}
            icon={Briefcase}
            title={entry.employer || 'Компания не указана'}
            detail={[entry.title, listPeriod(entry)].filter(Boolean).join(' · ')}
            onClick={() => props.open({ page: 'job', entryId: entry.id })}
          />
        ))}
        <ProfileMobileRow
          icon={Plus}
          title="Добавить место работы"
          onClick={() => props.open({ page: 'jobadd' })}
        />
      </ProfileMobileGroup>
    </>
  );
}

function MobileExperienceFacts({
  entry,
  memory,
}: {
  readonly entry: ResumeExperienceInput;
  readonly memory: ProfileMobileDataProps['memory'];
}) {
  const chronology = memory.find((fact) => fact.id === entry.chronologyMemoryId);
  const linked = entry.bulletMemoryIds.flatMap((id) => memory.filter((fact) => fact.id === id));
  const confirmed =
    linked.length > 0 &&
    linked.length === entry.bulletMemoryIds.length &&
    linked.every(
      (fact) => fact.status === 'confirmed' && fact.confidence === 'candidate-confirmed',
    );
  const workplace =
    entry.workplaceType === 'on_site'
      ? 'офис'
      : entry.workplaceType === 'hybrid'
        ? 'гибрид'
        : entry.workplaceType === 'remote'
          ? 'удалённо'
          : undefined;
  const source = !chronology
    ? 'Не указан'
    : chronology.confidence === 'coach-hypothesis'
      ? 'Выведено консультантом'
      : 'Со слов кандидата';
  return (
    <ProfileMobileGroup>
      <ProfileMobileKeyValue label="Место">
        {[entry.location, workplace].filter(Boolean).join(', ') || 'Не указано'}
      </ProfileMobileKeyValue>
      <ProfileMobileKeyValue label="Источник">
        {[source, profileMobileDate(chronology?.createdAt)].filter(Boolean).join(', ')}
      </ProfileMobileKeyValue>
      <ProfileMobileKeyValue label="Подтверждено">
        {confirmed ? 'вами' : 'не подтверждено вами'}
      </ProfileMobileKeyValue>
      <ProfileMobileKeyValue label="Размер команды">
        <span className="pm-unk">неизвестно</span>
      </ProfileMobileKeyValue>
    </ProfileMobileGroup>
  );
}

export function ProfileMobileExperienceDetail(props: ExperienceProps) {
  const entry = props.draft.experience.find((item) => item.id === props.route.entryId);
  if (!entry) return <p className="pm-note">Место работы больше не найдено в профиле.</p>;
  const bullets = responsibilityBullets(entry, props.memory);
  return (
    <>
      <div className="pm-hero">
        <h2>{entry.employer || 'Компания не указана'}</h2>
        <p>{entry.title || 'Должность не указана'}</p>
        <p className="num">{periodLabel(entry)}</p>
      </div>
      <MobileExperienceFacts entry={entry} memory={props.memory} />
      {bullets.length ? (
        <ProfileMobileGroup title="Достижения">
          {bullets.map((bullet, index) => (
            <div className="pm-bul" key={`${index}:${bullet}`}>
              {bullet}
            </div>
          ))}
        </ProfileMobileGroup>
      ) : null}
      {entry.skills?.length ? (
        <>
          <h3 className="pm-cap">Навыки на этом месте</h3>
          <div className="pm-chips">
            {entry.skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
        </>
      ) : null}
      <ProfileMobileGroup>
        <ProfileMobileRow
          icon={PencilSimple}
          title="Изменить место"
          onClick={() => props.open({ page: 'jobedit', entryId: entry.id })}
        />
      </ProfileMobileGroup>
    </>
  );
}

export function ProfileMobileExperienceEditor(props: ExperienceProps) {
  const [initialEntry] = useState(() =>
    props.route.page === 'jobadd'
      ? addExperience(props.draft, `manual-${crypto.randomUUID()}`).experience.at(-1)!
      : props.draft.experience.find((item) => item.id === props.route.entryId),
  );
  const entry =
    props.route.page === 'jobadd'
      ? initialEntry
      : props.draft.experience.find((item) => item.id === props.route.entryId);
  const currentDraft = useRef(props.draft);
  currentDraft.current = props.draft;
  if (!entry) return <p className="pm-note">Место работы больше не найдено в профиле.</p>;
  const save = (patch: Partial<ResumeExperienceInput>) => {
    const draft = currentDraft.current;
    const next = draft.experience.some((item) => item.id === entry.id)
      ? updateExperience(draft, entry.id, patch)
      : { ...draft, experience: [...draft.experience, { ...entry, ...patch }] };
    currentDraft.current = next;
    return props.onSectionSave(next);
  };
  return (
    <>
      <ProfileMobilePositionEditor
        entry={entry}
        candidateId={props.candidateId}
        memory={props.memory}
        isNew={props.route.page === 'jobadd'}
        saving={props.saving}
        onSave={save}
        onDone={props.back}
        onCancel={props.back}
        onManualExperienceFactAdded={props.onManualExperienceFactAdded}
      />
    </>
  );
}
