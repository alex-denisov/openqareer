import { useState, type FormEvent } from 'react';
import { pluralRu } from '../../../shared/pluralRu';
import { CheckCircle, Circle, Plus, Target, Question, CaretRight } from '@phosphor-icons/react';
import { addSkill } from './resumeStudioModel';
import { ProfileMobileGroup, ProfileMobileRow, profileMobileDate } from './ProfileMobileElements';
import type { ProfileMobileDataProps, ProfileMobileNavigationProps } from './profileMobileTypes';
import { useProvenanceLabelOf } from './ProfileProvenanceChip';
import { SkillConfirmEntry } from './SkillConfirmEntry';
import { skillStatusLabel } from './skillStatusLabel';
import { useSkillConfirmations } from './useSkillConfirmations';
import type { SkillConfirmation } from '../skills/skillConfirmationApi';
import { provenanceLabel } from './profileProvenance';
import type { ResumeSkillInput } from './resumeTypes';
import {
  SKILL_CONFIRMATION_HINT,
  confirmedSkillsLine,
  orderSkillsByVerification,
} from './skillConfirmation';

// Mockup 2 (390): «Подтверждён», «Разобрано в беседе», «Квиз не пройден» or «Без квиза»; an unknown status code is never
// shown as is. The source and its date read as one phrase: «из LinkedIn, 12.09».
const UNKNOWN_SOURCE = 'Источник не указан';

/** Своя подпись навыка, иначе импорт, из которого он пришёл («из LinkedIn, 25.09»), как у «Опыта». */
export function skillSourceLabel(
  skill: ResumeSkillInput,
  labelOf: (memoryId: string | undefined) => string = () => UNKNOWN_SOURCE,
): string {
  const own = skill.source?.trim();
  if (own) return own;
  const imported = skill.evidenceMemoryId ? labelOf(skill.evidenceMemoryId) : '';
  return imported && imported !== provenanceLabel(undefined) ? imported : UNKNOWN_SOURCE;
}

export function mobileSkillLabels(
  skill: ResumeSkillInput,
  labelOf?: (memoryId: string | undefined) => string,
  confirmation?: SkillConfirmation,
) {
  const label = skillStatusLabel(skill, confirmation);
  // The 390 row of mockup 2 says «Подтверждён»; 1440 says «Подтверждено».
  const status = label === 'Подтверждено' ? 'Подтверждён' : label;
  const verified = label === 'Подтверждено' || label === 'Разобрано в беседе';
  const rejected = label === 'Квиз не пройден';
  const source = skillSourceLabel(skill, labelOf);
  const date = profileMobileDate(skill.verifiedAt);
  return {
    verified,
    rejected,
    status,
    source,
    date,
    origin: [source, date].filter(Boolean).join(', '),
  };
}

function MobileSkillRow({
  skill,
  confirmation,
}: {
  readonly skill: ResumeSkillInput;
  readonly confirmation?: SkillConfirmation;
}) {
  const { verified, rejected, status, source, date, origin } = mobileSkillLabels(
    skill,
    useProvenanceLabelOf(),
    confirmation,
  );
  const Icon = verified ? CheckCircle : rejected ? Question : Circle;
  return (
    <details className="profile-mobile-skill">
      <summary className={`pm-row${rejected ? ' is-warn' : ''}`}>
        <span className="pm-ico">
          <Icon size="1em" aria-hidden="true" />
        </span>
        <span className="pm-main">
          <b>{skill.name}</b>
          <small>
            {status} · {origin}
          </small>
        </span>
        <CaretRight className="pm-chev" size="1em" aria-hidden="true" />
      </summary>
      <dl className="pm-find">
        <div>
          <dt>Статус</dt>
          <dd>{status}</dd>
        </div>
        <div>
          <dt>Источник</dt>
          <dd>{source}</dd>
        </div>
        {date ? (
          <div>
            <dt>Дата проверки</dt>
            <dd>{date}</dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

function ProfileMobileSkillActions(props: ProfileMobileDataProps & ProfileMobileNavigationProps) {
  return (
    <ProfileMobileGroup>
      <ProfileMobileRow
        icon={Plus}
        title="Добавить навык"
        onClick={() => props.open({ page: 'skilladd' })}
      />
      {/* Temporary 390 entry: the mockup puts it in «Карьера», which is not built yet (block B). */}
      {props.onOpenRoleSkillAssessment ? (
        <ProfileMobileRow
          icon={Target}
          title="Проверка навыков роли"
          detail="Вопросы по навыкам выбранной роли"
          onClick={props.onOpenRoleSkillAssessment}
        />
      ) : null}
    </ProfileMobileGroup>
  );
}

export function ProfileMobileSkills(props: ProfileMobileDataProps & ProfileMobileNavigationProps) {
  const skills = orderSkillsByVerification(props.draft.skills ?? []);
  const [all, setAll] = useState(false);
  const visible = all ? skills : skills.slice(0, 5);
  const confirmations = useSkillConfirmations(props.candidateId);
  return (
    <>
      <section className="pm-group">
        <h3 className="pm-cap">{pluralRu(skills.length, ['навык', 'навыка', 'навыков'])}</h3>
        <div className="pm-list profile-mobile-skills-list" aria-label="Все навыки профиля">
          {visible.map((skill) => (
            <MobileSkillRow
              key={skill.id}
              skill={skill}
              confirmation={confirmations.confirmationOf(skill.name)}
            />
          ))}
        </div>
        {skills.length > 5 ? (
          <button
            type="button"
            className="pm-foot profile-skill-disclosure"
            aria-expanded={all}
            aria-label={all ? 'Свернуть список навыков' : 'Показать все навыки'}
            onClick={() => setAll((current) => !current)}
          >
            Показано {visible.length} из {skills.length}
          </button>
        ) : (
          <p className="pm-foot">
            Показано {skills.length} из {skills.length}
          </p>
        )}
      </section>
      <ProfileMobileSkillActions {...props} />
      <SkillConfirmEntry
        skills={confirmations.skills}
        className="pm-cta"
        onDiscuss={props.onDiscussSkill}
        onApplied={() => {
          confirmations.reload();
          props.onRetry();
        }}
      />
      <p className="pm-foot">
        {skills.length ? `${confirmedSkillsLine(skills)} ` : ''}
        {SKILL_CONFIRMATION_HINT}
      </p>
    </>
  );
}

function useMobileSkillAdd(
  props: ProfileMobileDataProps & Pick<ProfileMobileNavigationProps, 'back'>,
) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    if (
      props.draft.skills?.some(
        (skill) => skill.name.trim().toLocaleLowerCase('ru') === value.toLocaleLowerCase('ru'),
      )
    ) {
      setError('Такой навык уже есть в профиле.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = addSkill(props.draft, value);
      const skills = next.skills?.map((skill, index, all) =>
        index === all.length - 1 ? { ...skill, source: 'со слов кандидата' } : skill,
      );
      if ((await props.onSectionSave({ ...next, skills })) === false) return;
      props.back();
    } catch {
      setError('Не сохранилось: нет связи с сервером. Текст остался в поле.');
    } finally {
      setBusy(false);
    }
  };
  return { name, setName, error, busy, submit };
}

export function ProfileMobileSkillAdd(
  props: ProfileMobileDataProps & Pick<ProfileMobileNavigationProps, 'back'>,
) {
  const { name, setName, error, busy, submit } = useMobileSkillAdd(props);
  return (
    <form className="pm-view profile-mobile-skill-form" onSubmit={(event) => void submit(event)}>
      <ProfileMobileGroup>
        <label className="pm-field">
          <span>Навык</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Terraform"
            autoComplete="off"
            required
            maxLength={160}
          />
        </label>
      </ProfileMobileGroup>
      <p className="pm-foot">
        Навык попадёт в профиль с пометкой «со слов кандидата». Подтвердить его можно квизом.
      </p>
      {error ? (
        <p className="career-resume-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pm-savebar">
        <button
          className="pm-cta"
          type="submit"
          disabled={!name.trim() || busy || props.saving}
          aria-busy={busy || undefined}
        >
          Добавить
        </button>
      </div>
    </form>
  );
}
