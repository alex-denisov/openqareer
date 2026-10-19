import { useState, type FormEvent } from 'react';
import { pluralRu } from '../../../shared/pluralRu';
import {
  CheckCircle,
  Circle,
  ListChecks,
  Plus,
  Target,
  Question,
  CaretRight,
} from '@phosphor-icons/react';
import { addSkill } from './resumeStudioModel';
import { ProfileMobileGroup, ProfileMobileRow, profileMobileDate } from './ProfileMobileElements';
import type { ProfileMobileDataProps, ProfileMobileNavigationProps } from './profileMobileTypes';
import type { ResumeSkillInput } from './resumeTypes';

// Mockup 2 (390): «Подтверждён», «Не проверен» or «Без квиза»; an unknown status code is never
// shown as is. The source and its date read as one phrase: «из LinkedIn, 12.09».
export function mobileSkillLabels(skill: ResumeSkillInput) {
  const verified = skill.status === 'подтверждён';
  const rejected = skill.status === 'не подтверждён';
  const status = verified ? 'Подтверждён' : rejected ? 'Не проверен' : 'Без квиза';
  const source = skill.source || 'Источник не указан';
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

function MobileSkillRow({ skill }: { readonly skill: ResumeSkillInput }) {
  const { verified, rejected, status, source, date, origin } = mobileSkillLabels(skill);
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
  const skills = props.draft.skills ?? [];
  const [all, setAll] = useState(false);
  const visible = all ? skills : skills.slice(0, 5);
  return (
    <>
      <section className="pm-group">
        <h3 className="pm-cap">{pluralRu(skills.length, ['навык', 'навыка', 'навыков'])}</h3>
        <div className="pm-list profile-mobile-skills-list" aria-label="Все навыки профиля">
          {visible.map((skill) => (
            <MobileSkillRow key={skill.id} skill={skill} />
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
      <button
        className="pm-cta"
        type="button"
        disabled={!props.onOpenSkillQuizBank}
        onClick={props.onOpenSkillQuizBank}
      >
        <ListChecks size="1em" aria-hidden="true" />
        Пройти квиз по навыкам
      </button>
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
