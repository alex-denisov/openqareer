import { vacancyFitTone } from '../../../../shared/vacancyFitPercent';
import { getMatchedVacancies } from '../../coach/matchedVacancyApi';
import { getRoleHypotheses } from '../../coach/coachApi';
import { getRoleSkillDemand } from '../../skills/roleSkillDemandApi';
import { Icon, InfoTip, Link } from '../kit';
import { buildNodePath } from '../routes';
import { ActionLink, BlockError, BlockSkeleton, LeadActions, type ScreenAction } from './parts';
import { skillFit, vacancyRow, type VacancyRow } from './todayModel';
import { useLoad } from './useLoad';

const VACANCIES: ScreenAction = {
  label: 'Смотреть вакансии',
  icon: 'search',
  path: buildNodePath('s07'),
};
const FIT_SOURCE =
  'Совпадение требований вакансии с подтверждённым опытом профиля. Вакансии с hh.ru и сайтов компаний.';
const ROWS_SHOWN = 3;

async function loadVacancyRows(signal: AbortSignal): Promise<readonly VacancyRow[]> {
  const items = await getMatchedVacancies(signal);
  return items.slice(0, ROWS_SHOWN).map(vacancyRow);
}

function VacancyRows({ rows }: { readonly rows: readonly VacancyRow[] }) {
  return (
    <ul className="rows">
      {rows.map((row) => (
        <li className="row" key={row.id}>
          <div>
            <Link className="row-title" to={row.path}>
              {row.title}
            </Link>
            {row.sub ? <div className="row-sub">{row.sub}</div> : null}
          </div>
          <div className="row-meta num">{row.salary}</div>
          {row.fit === null ? null : (
            <span className={`fit ${vacancyFitTone(row.fit)} num`}>
              {row.fit}
              <small>%</small>
              <span className="vh"> совпадение</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface VacanciesModuleProps {
  readonly title: string;
  /** Главный блок экрана: крупный заголовок и залитая кнопка. */
  readonly lead: boolean;
}

/** Подходящие вакансии: три первые строки подборки и переход ко всем. */
export function VacanciesModule({ title, lead }: VacanciesModuleProps) {
  const rows = useLoad(loadVacancyRows);
  const tip = <InfoTip label="Как посчитано" text={FIT_SOURCE} />;
  const body =
    rows.state === 'loading' ? (
      <BlockSkeleton label="Загружаем вакансии" rows={ROWS_SHOWN} />
    ) : rows.state === 'error' ? (
      <BlockError text="Не удалось загрузить вакансии." onRetry={rows.retry} />
    ) : rows.data.length === 0 ? (
      <p className="mod-text">Подходящих вакансий пока нет</p>
    ) : (
      <VacancyRows rows={rows.data} />
    );
  if (lead) {
    return (
      <section className="lead" aria-labelledby="today-vacancies">
        <div className="lead-head">
          <h2 className="lead-title" id="today-vacancies">
            {title}
          </h2>
          {tip}
        </div>
        {body}
        <LeadActions primary={VACANCIES} />
      </section>
    );
  }
  return (
    <section className="mod" aria-labelledby="today-vacancies">
      <h3 className="mod-title" id="today-vacancies">
        {title}
        {tip}
      </h3>
      {body}
      <div className="actions">
        <Link className="row-act" to={VACANCIES.path}>
          Все вакансии
          <Icon name="right" />
        </Link>
      </div>
    </section>
  );
}

const ROLES: ScreenAction = { label: 'Выбрать роль', icon: 'compass', path: buildNodePath('s10') };
const SEARCH_ROLE: ScreenAction = {
  label: 'Искать эту роль',
  icon: 'search',
  path: buildNodePath('s07'),
};

/** «Ищу, кем работать»: ближайшая роль из предложенных. */
export function RoleOptionsModule({ title }: { readonly title: string }) {
  const roles = useLoad(getRoleHypotheses);
  if (roles.state === 'loading') return <BlockSkeleton label="Подбираем роли" />;
  if (roles.state === 'error') {
    return <BlockError text="Не удалось загрузить роли." onRetry={roles.retry} />;
  }
  const [closest] = roles.data;
  return (
    <section className="lead" aria-labelledby="today-role">
      <h2 className="lead-title" id="today-role">
        {closest ? `Ближе всего — роль «${closest.titleRu || closest.title}»` : title}
      </h2>
      <LeadActions primary={closest ? SEARCH_ROLE : ROLES}>
        {closest ? <ActionLink action={{ ...ROLES, label: 'Другие роли' }} /> : null}
      </LeadActions>
    </section>
  );
}

const CHECK_SKILLS: ScreenAction = {
  label: 'Проверить навыки',
  icon: 'checkc',
  path: buildNodePath('c04'),
};

function loadSkillDemand() {
  return getRoleSkillDemand();
}

function SkillList({
  title,
  icon,
  names,
}: {
  readonly title: string;
  readonly icon: 'checkc' | 'circle';
  readonly names: readonly string[];
}) {
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {names.map((name) => (
          <li key={name}>
            <Icon name={icon} />
            {name}
          </li>
        ))}
      </ul>
    </>
  );
}

/** «Меняю профессию»: частые требования новой роли — что есть и чего не хватает. */
export function ProfessionFitModule({ title }: { readonly title: string }) {
  const demand = useLoad(loadSkillDemand);
  if (demand.state === 'loading') return <BlockSkeleton label="Считаем требования" rows={3} />;
  if (demand.state === 'error') {
    return <BlockError text="Не удалось загрузить требования." onRetry={demand.retry} />;
  }
  const fit = skillFit(demand.data.roles[0]);
  if (!fit) {
    return (
      <section className="lead long" aria-labelledby="today-fit">
        <h2 className="lead-title is-long" id="today-fit">
          {title}
        </h2>
        <LeadActions primary={CHECK_SKILLS} />
      </section>
    );
  }
  return (
    <section className="lead long" aria-labelledby="today-fit">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="today-fit">
          {fit.title}
        </h2>
        <InfoTip label="Как посчитано" text={fit.source} />
      </div>
      <p className="lead-sub">{fit.role}</p>
      <div className="reqs">
        {fit.have.length > 0 ? (
          <div className="have">
            <SkillList title="Есть" icon="checkc" names={fit.have} />
          </div>
        ) : null}
        {fit.lack.length > 0 ? (
          <div className="lack">
            <SkillList title="Не хватает" icon="circle" names={fit.lack} />
          </div>
        ) : null}
      </div>
      <LeadActions primary={CHECK_SKILLS} />
    </section>
  );
}

const PLAN: ScreenAction = { label: 'Открыть план', icon: 'path', path: buildNodePath('d01') };

/** «Работаю»: план первых 90 дней. */
export function OnboardingPlanModule({ title }: { readonly title: string }) {
  return (
    <section className="lead" aria-labelledby="today-plan">
      <h2 className="lead-title" id="today-plan">
        {title}
      </h2>
      <LeadActions primary={PLAN} />
    </section>
  );
}
