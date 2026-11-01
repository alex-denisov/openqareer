import { useEffect, useState } from 'react';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import { getRoleSkillDemand, type RoleSkillDemand } from '../skills/roleSkillDemandApi';

/** The server answers `pending` while it reads the selection in the background. */
const PENDING_RETRY_MS = 5_000;
const PENDING_RETRIES = 12;

function useRoleSkillDemand(candidateId: string): readonly RoleSkillDemand[] {
  const [roles, setRoles] = useState<readonly RoleSkillDemand[]>([]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      void getRoleSkillDemand().then(
        (result) => {
          if (!active) return;
          if (result.state === 'pending' && attempt < PENDING_RETRIES) {
            timer = setTimeout(() => load(attempt + 1), PENDING_RETRY_MS);
          }
          setRoles(result.roles);
        },
        () => {
          if (active) setRoles([]);
        },
      );
    };
    setRoles([]);
    load(0);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [candidateId]);
  return roles;
}

function RoleDemand({ demand }: { readonly demand: RoleSkillDemand }) {
  const date = new Date(demand.observedAt).toLocaleDateString('ru-RU');
  return (
    <div className="profile-desktop-assessment-role">
      <div className="profile-desktop-assessment-row">
        <div>
          <b>{demand.roleTitle}</b>
          <p>
            Что чаще всего требуют вакансии роли: {pluralRu(demand.sampleSize, ['вакансия', 'вакансии', 'вакансий'])}{' '}
            в подборке, данные на {date}.
          </p>
        </div>
      </div>
      <ul className="profile-desktop-demand-list">
        {demand.skills.map((skill) => (
          <li key={skill.name}>
            <b>{skill.name}</b>
            <span className="profile-desktop-skill-source">
              {skill.vacancies} из {demand.sampleSize}
            </span>
            <span className={`profile-desktop-skill-tag ${skill.inProfile ? 'is-ok' : 'is-dim'}`}>
              {skill.inProfile ? (
                <CheckCircle size="1em" aria-hidden="true" />
              ) : (
                <Circle size="1em" aria-hidden="true" />
              )}
              {skill.inProfile ? 'есть в профиле' : 'нет в профиле'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * «Проверка навыков» (B591): for each target role, the skills real vacancies
 * of the selection require most often, marked against the profile. Hidden
 * when no role has enough vacancies, instead of a sentence about the sample.
 */
export function ProfileSkillDemandCard(props: {
  readonly candidateId: string;
  readonly onOpen?: () => void;
}) {
  const roles = useRoleSkillDemand(props.candidateId);
  if (roles.length === 0) return null;
  return (
    <section
      className="career-profile-screen-panel profile-desktop-assessment"
      aria-labelledby="profile-assessment-title"
    >
      <div className="career-profile-screen-section-head">
        <h2 id="profile-assessment-title">Проверка навыков</h2>
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          disabled={!props.onOpen}
          onClick={props.onOpen}
        >
          Проверить навыки
        </button>
      </div>
      {roles.map((demand) => (
        <RoleDemand key={demand.roleTitle} demand={demand} />
      ))}
    </section>
  );
}
