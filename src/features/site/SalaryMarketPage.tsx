import {
  skillFamilyForLabel,
  SKILL_LABEL_CLASSIFICATION_VERSION,
} from '../../../shared/skillLabelClassification';
import React from 'react';
import {
  SALARY_GRADE_LABELS,
  SALARY_LOCATION_LABELS,
  selectSalaryLocation,
  salaryDisplayLabel,
  salaryRoleLabel,
  selectSalaryGrade,
  salaryRolePath,
} from '../../../shared/salaryMarketPublic';
export { salaryRolePath } from '../../../shared/salaryMarketPublic';
export { salarySnapshotIndexable } from '../../../shared/salaryMarketSnapshot';
import {
  MIN_SALARY_MARKET_SAMPLE,
  MAX_SALARY_MARKET_GROUPS,
  SALARY_MARKET_INDEX_LIMIT,
} from '../../../shared/salaryMarketSnapshot';
import type {
  SalarySkillQuarterlyTrend,
  SalaryMarketGrade,
  SalaryMarketLocation,
  SalaryMarketIndexEntry,
  SalaryMarketSnapshot,
} from '../../../shared/salaryMarketSnapshot';

export const SALARY_MARKET_TITLE = 'Зарплаты и навыки по профессиям | openqareer';
export const SALARY_MARKET_DESCRIPTION =
  'Вилки и навыки из каталога вакансий: валюта, период, размер и дата выборки.';
export const SALARY_MARKET_TEMPLATE = 'salary-market.html';

type SalaryGroup = Extract<
  SalaryMarketSnapshot['salary'],
  { status: 'available' }
>['groups'][number];
const PERIOD = { hour: 'в час', month: 'в месяц', year: 'в год' } as const;
const TAX_BASIS = {
  gross: 'до налогов',
  net: 'после налогов',
  unknown: 'налоги не указаны',
} as const;
const RANKS = ['p25', 'p50', 'p75', 'p90'] as const;

export function salaryPageTitle(snapshot: SalaryMarketSnapshot | null): string {
  return snapshot
    ? `Зарплаты и навыки: ${salaryRoleLabel(snapshot)} | openqareer`
    : SALARY_MARKET_TITLE;
}
export function salaryGroupLabel(group: SalaryGroup): string {
  return `${group.currency}, ${PERIOD[group.period]}, ${TAX_BASIS[group.taxBasis]}`;
}
function SalaryDistribution({ group }: { readonly group: SalaryGroup }) {
  const amount = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return (
    <section className="sm-distribution" aria-labelledby="salary-distribution-title">
      <div>
        <h3 id="salary-distribution-title">{salaryGroupLabel(group)}</h3>
        <p className="ps-soft">
          {group.sampleSize.toLocaleString('ru-RU')} вакансий с полной вилкой и периодом оплаты.
        </p>
      </div>
      <dl className="sm-percentiles">
        {RANKS.map((rank) => (
          <div key={rank}>
            <dt>{rank.toUpperCase()}</dt>
            <dd>
              {amount(group.lower[rank])} <span>–</span> {amount(group.upper[rank])}
            </dd>
          </div>
        ))}
      </dl>
      <p className="ps-soft">
        Перцентили нижних и верхних границ вилок. Это не индивидуальная зарплата.
      </p>
    </section>
  );
}
export interface SalaryMarketPageProps {
  readonly snapshot: SalaryMarketSnapshot | null;
  readonly selectedGroup?: number;
  readonly grade?: SalaryMarketGrade;
  readonly location?: SalaryMarketLocation;
  readonly skillsPage?: number;
  readonly related?: readonly SalaryMarketIndexEntry[];
}
function MarketHeading({ snapshot }: Pick<SalaryMarketPageProps, 'snapshot'>) {
  return (
    <header className="sm-heading">
      <nav className="ps-crumbs" aria-label="Навигационная цепочка">
        <a href="/">Главная</a>
        <span>/</span>
        <a href="/salaries">Зарплаты и навыки</a>
        <span>/</span>
        <span>{snapshot ? salaryRoleLabel(snapshot) : 'Нет данных'}</span>
      </nav>
      <p className="ps-label">Данные публичного каталога</p>
      <h1>
        {snapshot ? (
          <>
            Зарплаты и навыки
            <br />
            {salaryRoleLabel(snapshot)}
          </>
        ) : (
          'Зарплаты и навыки по профессиям'
        )}
      </h1>
      <p className="ps-intro">Вилки и навыки вакансий. Без пересчёта валют и догадок о грейде.</p>
      {snapshot ? (
        <p className="sm-provenance">
          {snapshot.sampleSize.toLocaleString('ru-RU')} вакансий · последние {snapshot.windowDays}{' '}
          дней · срез{' '}
          <time dateTime={snapshot.updatedAt}>
            {new Date(snapshot.updatedAt).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}
          </time>
        </p>
      ) : null}
    </header>
  );
}
function MarketSkills({
  snapshot,
  grade,
  selectedGroup = 0,
  skillsPage = 1,
  location = 'all',
}: SalaryMarketPageProps) {
  const pageCount = Math.max(1, Math.ceil((snapshot?.skills.length ?? 0) / 5));
  const currentPage = Math.max(1, Math.min(pageCount, skillsPage));
  const rows = snapshot?.skills.slice((currentPage - 1) * 5, currentPage * 5) ?? [];
  const href = (page: number) =>
    `${snapshot ? salaryRolePath(snapshot.role) : '/salaries'}?${grade ? `grade=${grade}&` : ''}${location !== 'all' ? `location=${location}&` : ''}group=${selectedGroup}&skills=${page}`;
  return (
    <section className="sm-skills" aria-labelledby="skills-title">
      <div className="sm-section-heading">
        <h2 id="skills-title">Навыки в вакансиях</h2>
        <span className="ps-soft">Top-15</span>
      </div>
      <p className="ps-note">
        Полные названия — в <a href="/vacancies">каталоге вакансий</a>.
      </p>
      <SkillHistoryContext trend={snapshot?.skillQuarterlyTrend} />
      {snapshot && snapshot.sampleSize >= MIN_SALARY_MARKET_SAMPLE && snapshot.skills.length > 0 ? (
        <>
          <SkillsRows
            rows={rows}
            trend={snapshot.skillQuarterlyTrend}
            denominator={snapshot.sampleSize}
            start={(currentPage - 1) * 5 + 1}
          />
          <DirectoryPages
            currentPage={currentPage}
            pageCount={pageCount}
            kind="навыки"
            hrefForPage={href}
          />
        </>
      ) : (
        <p className="sm-unavailable">
          Недостаточно опубликованных наблюдений для рейтинга навыков. Откройте каталог и сравните
          требования конкретных работодателей.
        </p>
      )}
    </section>
  );
}
const SKILL_FAMILY_LABELS = {
  technical: 'Технический',
  profile: 'Профильный',
  unconfirmed: 'Не определена',
} as const;
function SkillsRows({
  rows,
  denominator,
  start,
  trend,
}: {
  trend?: SalarySkillQuarterlyTrend;
  rows: SalaryMarketSnapshot['skills'];
  denominator: number;
  start: number;
}) {
  return (
    <ol
      className={`sm-skill-list${trend?.status === 'available' ? ' has-history' : ''}`}
      start={start}
    >
      {rows.map((skill) => (
        <li key={skill.name}>
          <span>
            {salaryDisplayLabel(skill.name, 24)}
            <small>{SKILL_FAMILY_LABELS[skillFamilyForLabel(skill.name)]}</small>
          </span>
          <span>
            <b>{skill.frequency.toLocaleString('ru-RU')}%</b>{' '}
            <small>
              {skill.count.toLocaleString('ru-RU')} из {denominator.toLocaleString('ru-RU')}
            </small>
          </span>
          <SkillHistoryChange name={skill.name} trend={trend} />
          <meter
            min="0"
            max="100"
            value={skill.frequency}
            aria-label={`${salaryDisplayLabel(skill.name, 24)}: доля вакансий`}
          >
            {skill.frequency}%
          </meter>
        </li>
      ))}
    </ol>
  );
}
function SkillHistoryContext({ trend }: { trend?: SalarySkillQuarterlyTrend }) {
  if (!trend) return null;
  const date = (value: string) => new Date(value).toLocaleDateString('ru-RU', { timeZone: 'UTC' });
  return (
    <div className="sm-history-note">
      <p>
        <b>Изменение доли навыков.</b> Текущий срез {date(trend.current.observedAt)}:{' '}
        {trend.current.sampleSize.toLocaleString('ru-RU')} вакансий.
      </p>
      {trend.status === 'insufficient_history' ? (
        <p>
          Нет сопоставимого сохранённого среза за 90–97 дней до текущего.{' '}
          {trend.earliestActualObservation ? (
            <>Первое фактическое наблюдение: {date(trend.earliestActualObservation)}.</>
          ) : (
            'Сохранённых наблюдений пока нет.'
          )}{' '}
          Без истории изменение неизвестно.
        </p>
      ) : (
        <>
          <p>
            Базовый срез {date(trend.baseline.observedAt)}:{' '}
            {trend.baseline.sampleSize.toLocaleString('ru-RU')} вакансий.{' '}
            {trend.status === 'insufficient_sample'
              ? 'В одной из выборок меньше 5 вакансий, сравнение недоступно.'
              : 'Разница — в процентных пунктах.'}
          </p>
        </>
      )}
    </div>
  );
}
function SkillHistoryChange({ name, trend }: { name: string; trend?: SalarySkillQuarterlyTrend }) {
  if (trend?.status !== 'available') return null;
  const change = trend.skills.find((row) => row.name === name);
  if (!change || change.status !== 'available' || !Number.isFinite(change.changePP))
    return <span className="sm-change">нет сравнения</span>;
  const delta = change.changePP.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  });
  return (
    <span className="sm-change">
      <b>{delta} п.п.</b>
      <small>было {change.baselineFrequency.toLocaleString('ru-RU')}%</small>
    </span>
  );
}

function MarketMethodology({ snapshot }: Pick<SalaryMarketPageProps, 'snapshot'>) {
  return (
    <section id="methodology" className="sm-methodology">
      <h2>Методика</h2>
      <div className="sm-methodology-grid">
        <div>
          <h3>Выборка за 90 дней</h3>
          <p>
            Частоту считаем от всех карточек, в том числе без навыков.{' '}
            {snapshot?.profession?.kind === 'b267'
              ? 'Профессия — по классификатору.'
              : 'Профессия пока не определена; выборка по названию.'}{' '}
            Это срез каталога, а не всего рынка.
          </p>
        </div>
        <div>
          <h3>Сопоставимость</h3>
          <p>
            Валюты, периоды и налоги отдельно. Ближайший ранг; P50 — медиана. Неполные вилки и суммы
            без периода исключены. До {MAX_SALARY_MARKET_GROUPS} групп.
          </p>
        </div>
        <div>
          <h3>
            {snapshot?.grades === 'published_title_evidence'
              ? 'Грейды и категории'
              : 'Категории и ограничения'}
          </h3>
          <p>
            Individual contributor не означает junior. Словарь openqareer: технические — инструменты
            и инфраструктура; профильные — управление, продукт, комплаенс. Неизвестные не
            классифицируем. Не оцениваем важность и владение. Нет в срезе — не значит нет в
            вакансии.
          </p>
        </div>
      </div>
      {snapshot?.skillEvidence && (
        <p className="ps-note">
          Карточек со скрытыми навыками: {snapshot.skillEvidence.withheldClusterCount}. Himalayas
          передаёт категории должностей. В карточках из нескольких источников происхождение навыков
          неизвестно.
        </p>
      )}
      <MarketExclusions snapshot={snapshot} />
    </section>
  );
}
function MarketExclusions({ snapshot }: Pick<SalaryMarketPageProps, 'snapshot'>) {
  return (
    <>
      {' '}
      {snapshot?.salary.excluded ? (
        <p className="ps-note">
          Исключены из зарплат: без периода {snapshot.salary.excluded.missingPeriod}, без валюты{' '}
          {snapshot.salary.excluded.missingCurrency}, неполная вилка{' '}
          {snapshot.salary.excluded.openRange}, некорректная вилка{' '}
          {snapshot.salary.excluded.invalidRange}, малые группы{' '}
          {snapshot.salary.excluded.belowMinimumSample}.
          {snapshot.salary.excluded.outsidePublishedGroups ? (
            <>
              {' '}
              За пределами опубликованных групп: {
                snapshot.salary.excluded.outsidePublishedGroups
              }{' '}
              вакансий.
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
function CompareResumeCta({
  snapshot,
  grade,
  location,
}: Pick<SalaryMarketPageProps, 'snapshot' | 'grade' | 'location'>) {
  const ready =
    snapshot && snapshot.sampleSize >= MIN_SALARY_MARKET_SAMPLE && snapshot.skills.length > 0;
  return (
    <section
      className="ps-cta-box sm-gap ym-hide-content"
      data-sm-gap={ready ? '' : undefined}
      data-role={snapshot?.role}
      data-grade={grade ?? ''}
      data-location={location ?? 'all'}
    >
      <h2>Сравните навыки</h2>
      {ready ? (
        <>
          <p>Через запятую или строку. Сравним с Top-15 в браузере.</p>
          <form data-gap-form>
            <label htmlFor="gap-skills">Навыки</label>
            <textarea
              id="gap-skills"
              className="ym-disable-keys"
              rows={3}
              maxLength={4000}
              required
              aria-describedby="gap-status"
            />
            <button className="ps-btn is-primary" type="submit" disabled>
              Сравнить навыки
            </button>
          </form>
          <p id="gap-status" role="status" aria-live="polite" />
          <div data-gap-results hidden />
          <noscript>Включите JavaScript для сравнения.</noscript>
        </>
      ) : (
        <p>
          Для сравнения нужна подготовленная выборка хотя бы из 5 вакансий с извлечёнными навыками.
        </p>
      )}
      <a className="ps-btn" href="/signup">
        Продолжить с резюме
      </a>
    </section>
  );
}
function SalaryBucketNavigation({
  groups,
  selectedGroup,
  path,
  grade,
  location = 'all',
}: {
  groups: readonly SalaryGroup[];
  selectedGroup: number;
  path: string;
  grade?: SalaryMarketGrade;
  location?: SalaryMarketLocation;
}) {
  const selected = groups[selectedGroup] ? selectedGroup : 0;
  const start = Math.floor(selected / 3) * 3;
  const href = (index: number) =>
    `${path}?${grade ? `grade=${grade}&` : ''}${location !== 'all' ? `location=${location}&` : ''}group=${index}`;
  return (
    <nav className="sm-groups" aria-label="Валюта, период оплаты и налоги">
      {start > 0 ? (
        <a className="ps-btn" href={href(start - 3)}>
          Предыдущие группы
        </a>
      ) : null}
      {groups.slice(start, start + 3).map((group, offset) => (
        <a
          className="ps-btn"
          key={`${group.currency}-${group.period}-${group.taxBasis}`}
          href={href(start + offset)}
          aria-current={selected === start + offset ? 'true' : undefined}
        >
          {salaryGroupLabel(group)}
        </a>
      ))}
      {start + 3 < groups.length ? (
        <a className="ps-btn" href={href(start + 3)}>
          Другие валюты и периоды
        </a>
      ) : null}
    </nav>
  );
}
function MarketSalaries({ snapshot, selectedGroup = 0, grade, location }: SalaryMarketPageProps) {
  const groups = snapshot?.salary.status === 'available' ? snapshot.salary.groups : [];
  const current = groups[selectedGroup] ?? groups[0];
  const path = snapshot ? salaryRolePath(snapshot.role) : '/salaries';
  return (
    <section className="sm-salary" aria-labelledby="salary-title">
      <div className="sm-section-heading">
        <h2 id="salary-title">Опубликованные зарплатные вилки</h2>
        <a href="#methodology">Как читать данные</a>
      </div>
      {current ? (
        <>
          <SalaryBucketNavigation
            groups={groups}
            selectedGroup={selectedGroup}
            path={path ?? '/salaries'}
            grade={grade}
            location={location}
          />
          <SalaryDistribution group={current} />
        </>
      ) : (
        <div className="sm-unavailable">
          <h3>Сравнимой зарплатной выборки пока нет</h3>
          <p>
            Для расчёта нужны хотя бы 5 сопоставимых вакансий с полной вилкой, одинаковой валютой,
            периодом оплаты и способом указания налогов. Мы не определяем месяц или год по величине
            суммы.
          </p>
          <a className="ps-btn" href="/vacancies">
            Посмотреть опубликованные вакансии
          </a>
        </div>
      )}
    </section>
  );
}
function MarketGrades({
  snapshot,
  grade,
  location = 'all',
}: Pick<SalaryMarketPageProps, 'snapshot' | 'grade' | 'location'>) {
  const slices = snapshot?.gradeSlices?.filter((row) => row.sampleSize > 0) ?? [];
  if (!snapshot || slices.length === 0) return null;
  const path = salaryRolePath(snapshot.role);
  const selected = slices.find((row) => row.grade === grade);
  return (
    <section className="sm-skills" aria-labelledby="grade-title">
      <h2 id="grade-title">Уровень в названии вакансии</h2>
      <nav className="sm-groups" aria-label="Грейд из опубликованного названия">
        <a
          className="ps-btn"
          href={location === 'all' ? path : `${path}?location=${location}`}
          aria-current={!grade ? 'true' : undefined}
        >
          Все уровни ({snapshot.sampleSize})
        </a>
        {slices.map((slice) => (
          <a
            className="ps-btn"
            key={slice.grade}
            href={`${path}?grade=${slice.grade}${location !== 'all' ? `&location=${location}` : ''}`}
            aria-current={grade === slice.grade ? 'true' : undefined}
          >
            {SALARY_GRADE_LABELS[slice.grade]} ({slice.sampleSize})
          </a>
        ))}
      </nav>
      <p className="ps-soft">Грейд — из названия; без маркера неизвестен.</p>
      {selected && selected.evidence.markers.length > 0 ? (
        <p className="ps-note">
          Примеры маркеров:{' '}
          {selected.evidence.markers
            .slice(0, 3)
            .map((marker) => salaryDisplayLabel(marker, 16))
            .join(', ')}
          .
        </p>
      ) : null}
    </section>
  );
}

function MarketLocations({ snapshot, grade, location = 'all' }: SalaryMarketPageProps) {
  if (!snapshot) return null;
  if (!snapshot.geography)
    return <p className="sm-unavailable">Географические срезы ещё не подготовлены.</p>;
  const path = salaryRolePath(snapshot.role);
  return (
    <section className="sm-skills" aria-labelledby="location-title">
      <h2 id="location-title">География вакансий</h2>
      <form method="get" action={path} className="sm-groups">
        {grade ? <input type="hidden" name="grade" value={grade} /> : null}
        <label htmlFor="salary-location">География</label>
        <select id="salary-location" name="location" defaultValue={location}>
          <option value="all">Все страны ({snapshot.sampleSize})</option>
          {snapshot.locationSlices
            ?.filter((row) => row.sampleSize > 0)
            .map((row) => (
              <option key={row.location} value={row.location}>
                {SALARY_LOCATION_LABELS[row.location]} ({row.sampleSize})
              </option>
            ))}
        </select>
        <button className="ps-btn" type="submit">
          Показать
        </button>
      </form>
      <p className="ps-note">
        Явная страна: {snapshot.geography.explicitCountryCount}, неизвестна:{' '}
        {snapshot.geography.unknownCountryCount}, неоднозначна:{' '}
        {snapshot.geography.ambiguousCountryCount}. Удалённость пересекается со странами и не даёт
        права работать из любой страны.
      </p>
    </section>
  );
}

export function SalaryMarketPage(props: SalaryMarketPageProps) {
  const regional = selectSalaryLocation(props.snapshot, props.location);
  const visible = selectSalaryGrade(regional, props.grade);
  return (
    <>
      <main
        id="main"
        tabIndex={-1}
        className="ps-wrap ps-page sm-page"
        data-skill-classification={SKILL_LABEL_CLASSIFICATION_VERSION}
      >
        <MarketHeading snapshot={visible} />
        <MarketLocations {...props} />
        <MarketGrades snapshot={regional} grade={props.grade} location={props.location} />
        <MarketSalaries {...props} snapshot={visible} />
        <MarketSkills {...props} snapshot={visible} />
        <MarketMethodology snapshot={visible} />
        <CompareResumeCta snapshot={visible} grade={props.grade} location={props.location} />
        {props.related?.length ? (
          <section className="sm-skills" aria-labelledby="related-title">
            <h2 id="related-title">Смежные профессии</h2>
            <nav className="sm-groups" aria-label="Смежные профессии">
              {props.related.slice(0, 3).map((row) => (
                <a className="ps-btn" key={row.role} href={salaryRolePath(row.role)}>
                  {salaryDisplayLabel(row.roleLabel, 20)}
                </a>
              ))}
            </nav>
          </section>
        ) : null}
      </main>
    </>
  );
}

function DirectoryHeading() {
  return (
    <header className="sm-heading">
      <nav className="ps-crumbs" aria-label="Навигационная цепочка">
        <a href="/">Главная</a>
        <span>/</span>
        <span>Зарплаты и навыки</span>
      </nav>
      <p className="ps-label">Публичный инструмент</p>
      <h1>Зарплаты и навыки по профессиям</h1>
      <p className="ps-intro">
        Выберите профессию или название вакансии из текущего среза каталога. Мы показываем
        опубликованные вилки только там, где есть сравнимые данные.
      </p>
    </header>
  );
}
function DirectoryRoles({ roles }: { roles: readonly SalaryMarketIndexEntry[] }) {
  return (
    <ul className="sm-role-list">
      {roles
        .filter((role) => salaryRolePath(role.role))
        .map((role) => (
          <li key={role.role}>
            <a href={salaryRolePath(role.role)}>
              <b>{salaryRoleLabel(role)}</b>
              <span>
                {role.sampleSize.toLocaleString('ru-RU')} вакансий ·{' '}
                {role.profession?.kind === 'unclassified_title'
                  ? 'профессия пока не определена'
                  : role.indexable
                    ? 'зарплатная выборка доступна'
                    : 'сравнимых зарплат пока недостаточно'}
              </span>
            </a>
          </li>
        ))}
    </ul>
  );
}
function DirectoryPages({
  currentPage,
  pageCount,
  kind = 'должности',
  hrefForPage = (page) => `/salaries?page=${page}`,
}: {
  currentPage: number;
  pageCount: number;
  kind?: 'должности' | 'навыки';
  hrefForPage?: (page: number) => string;
}) {
  return (
    <>
      {' '}
      {pageCount > 1 ? (
        <nav className="sm-groups" aria-label={`Страницы: ${kind}`}>
          {currentPage > 1 ? (
            <a className="ps-btn" href={hrefForPage(currentPage - 1)}>
              Предыдущие {kind}
            </a>
          ) : null}
          <span>
            Страница {currentPage} из {pageCount}
          </span>
          {currentPage < pageCount ? (
            <a className="ps-btn" href={hrefForPage(currentPage + 1)}>
              Следующие {kind}
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
export function SalaryMarketDirectory({
  roles,
  page = 1,
}: {
  readonly page?: number;
  readonly roles: readonly SalaryMarketIndexEntry[];
}) {
  const pageCount = Math.max(1, Math.ceil(roles.length / 10));
  const currentPage = Math.max(1, Math.min(pageCount, page));
  const visible = roles.slice((currentPage - 1) * 10, currentPage * 10);
  return (
    <>
      <main
        id="main"
        tabIndex={-1}
        className="ps-wrap ps-page sm-page"
        data-skill-classification={SKILL_LABEL_CLASSIFICATION_VERSION}
      >
        <DirectoryHeading />
        <section className="sm-skills">
          <h2>Профессии и названия вакансий в текущем срезе</h2>
          {roles.length ? (
            <>
              <p className="ps-soft">
                До {SALARY_MARKET_INDEX_LIMIT} профессий и названий вакансий, сначала с доступной
                зарплатной выборкой. Число наблюдений относится к каталогу за 90 дней.
              </p>
              <DirectoryRoles roles={visible} />
              <DirectoryPages currentPage={currentPage} pageCount={pageCount} />
            </>
          ) : (
            <div className="sm-unavailable">
              <h3>Срез ещё не подготовлен</h3>
              <p>
                Названия должностей появятся после расчёта по данным каталога. Пока можно изучить
                требования и зарплаты в отдельных вакансиях.
              </p>
              <a href="/vacancies" className="ps-btn">
                Открыть каталог вакансий
              </a>
            </div>
          )}
        </section>
        <CompareResumeCta snapshot={null} />
      </main>
    </>
  );
}
