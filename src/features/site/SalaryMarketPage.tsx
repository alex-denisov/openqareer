import React from 'react';
import {
  SALARY_GRADE_LABELS,
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
  SalaryMarketIndexEntry,
  SalaryMarketSnapshot,
} from '../../../shared/salaryMarketSnapshot';

export const SALARY_MARKET_TITLE = 'Зарплаты и навыки по профессиям | openqareer';
export const SALARY_MARKET_DESCRIPTION =
  'Зарплатные вилки и навыки по данным публичного каталога вакансий. Сравнимые выборки с валютой, периодом оплаты, размером и датой наблюдения.';
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
          {group.sampleSize.toLocaleString('ru-RU')} вакансий с полной вилкой и указанным периодом
          оплаты.
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
        Слева перцентиль нижних границ, справа верхних. Это две отдельные выборки границ
        опубликованных вилок, а не диапазон индивидуальной зарплаты.
      </p>
    </section>
  );
}
export interface SalaryMarketPageProps {
  readonly snapshot: SalaryMarketSnapshot | null;
  readonly selectedGroup?: number;
  readonly grade?: SalaryMarketGrade;
  readonly skillsPage?: number;
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
      <p className="ps-intro">
        Что работодатели указывают в вакансиях: опубликованные вилки и востребованные навыки. Без
        пересчёта валют и догадок о грейде.
      </p>
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
}: SalaryMarketPageProps) {
  const pageCount = Math.max(1, Math.ceil((snapshot?.skills.length ?? 0) / 5));
  const currentPage = Math.max(1, Math.min(pageCount, skillsPage));
  const rows = snapshot?.skills.slice((currentPage - 1) * 5, currentPage * 5) ?? [];
  const href = (page: number) =>
    `${snapshot ? salaryRolePath(snapshot.role) : '/salaries'}?${grade ? `grade=${grade}&` : ''}group=${selectedGroup}&skills=${page}`;
  return (
    <section className="sm-skills" aria-labelledby="skills-title">
      <div className="sm-section-heading">
        <h2 id="skills-title">Навыки в вакансиях</h2>
        <span className="ps-soft">До 15 самых частых</span>
      </div>
      <p className="ps-note">
        Длинные названия сокращены с многоточием. Исходные формулировки — в{' '}
        <a href="/vacancies">каталоге вакансий</a>.
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
          <span>{salaryDisplayLabel(skill.name, 24)}</span>
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
          Отсутствие истории не означает нулевое изменение.
        </p>
      ) : (
        <>
          <p>
            Базовый срез {date(trend.baseline.observedAt)}:{' '}
            {trend.baseline.sampleSize.toLocaleString('ru-RU')} вакансий.{' '}
            {trend.status === 'insufficient_sample'
              ? 'В одной из выборок меньше 5 вакансий, сравнение недоступно.'
              : 'Разница сопоставимых долей указана в процентных пунктах. Это изменение двух каталожных выборок, а не оценка всего рынка.'}
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
      <h2>Откуда данные и что они означают</h2>
      <div className="sm-methodology-grid">
        <div>
          <h3>Каталожная выборка за 90 дней</h3>
          <p>
            Одна сведённая карточка каталога считается одним наблюдением. Частота навыка рассчитана
            от всех карточек выбранного среза, включая карточки без извлечённых навыков.{' '}
            {snapshot?.profession?.kind === 'b267'
              ? 'Названия объединены в профессию по классификатору openqareer.'
              : 'Это выборка по названию вакансии, которое пока не сопоставлено с профессией.'}{' '}
            Это срез каталога, а не всего рынка.
          </p>
        </div>
        <div>
          <h3>Сравниваем только сопоставимое</h3>
          <p>
            Разные валюты, периоды и налоговые условия показаны отдельно. P50 означает середину
            упорядоченного ряда границ вилок. Неполные диапазоны и суммы без периода исключены.
            Перцентили рассчитаны методом ближайшего ранга. Показываем до {MAX_SALARY_MARKET_GROUPS}{' '}
            самых крупных сопоставимых групп.
          </p>
        </div>
        <div>
          <h3>
            {snapshot?.grades === 'published_title_evidence'
              ? 'Грейд только из названия вакансии'
              : 'Грейды пока не подтверждены'}
          </h3>
          <p>
            Грейд показывается только при явном маркере в опубликованном названии вакансии. Это не
            проверка уровня специалиста. Individual contributor не означает junior. Историю роста
            зарплат пока нет, персональную оценку мы здесь не рассчитываем.
          </p>
        </div>
      </div>
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
          Не вошли в расчёт зарплат: без периода {snapshot.salary.excluded.missingPeriod}, без
          валюты {snapshot.salary.excluded.missingCurrency}, с неполной вилкой{' '}
          {snapshot.salary.excluded.openRange}, с некорректной вилкой{' '}
          {snapshot.salary.excluded.invalidRange}, в слишком малых группах{' '}
          {snapshot.salary.excluded.belowMinimumSample}.
          {snapshot.salary.excluded.outsidePublishedGroups ? (
            <>
              {' '}
              В других сравнимых группах осталось {
                snapshot.salary.excluded.outsidePublishedGroups
              }{' '}
              вакансий, не включённых в публикацию.
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
function CompareResumeCta() {
  return (
    <section className="ps-cta-box">
      <div>
        <h2>Какие требования подтверждает ваше резюме?</h2>
        <p>Загрузите резюме, проверьте факты профиля и посмотрите подходящие вакансии.</p>
      </div>
      <a className="ps-btn is-primary" href="/signup">
        Сравнить моё резюме с рынком
      </a>
    </section>
  );
}
function SalaryBucketNavigation({
  groups,
  selectedGroup,
  path,
  grade,
}: {
  groups: readonly SalaryGroup[];
  selectedGroup: number;
  path: string;
  grade?: SalaryMarketGrade;
}) {
  const selected = groups[selectedGroup] ? selectedGroup : 0;
  const start = Math.floor(selected / 3) * 3;
  const href = (index: number) => `${path}?${grade ? `grade=${grade}&` : ''}group=${index}`;
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
function MarketSalaries({ snapshot, selectedGroup = 0, grade }: SalaryMarketPageProps) {
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
function MarketGrades({ snapshot, grade }: Pick<SalaryMarketPageProps, 'snapshot' | 'grade'>) {
  const slices = snapshot?.gradeSlices?.filter((row) => row.sampleSize > 0) ?? [];
  if (!snapshot || slices.length === 0) return null;
  const path = salaryRolePath(snapshot.role);
  const selected = slices.find((row) => row.grade === grade);
  return (
    <section className="sm-skills" aria-labelledby="grade-title">
      <h2 id="grade-title">Уровень в названии вакансии</h2>
      <nav className="sm-groups" aria-label="Грейд из опубликованного названия">
        <a className="ps-btn" href={path} aria-current={!grade ? 'true' : undefined}>
          Все уровни ({snapshot.sampleSize})
        </a>
        {slices.map((slice) => (
          <a
            className="ps-btn"
            key={slice.grade}
            href={`${path}?grade=${slice.grade}`}
            aria-current={grade === slice.grade ? 'true' : undefined}
          >
            {SALARY_GRADE_LABELS[slice.grade]} ({slice.sampleSize})
          </a>
        ))}
      </nav>
      <p className="ps-soft">
        Фильтр использует только явные слова в названии вакансии. Уровень без подтверждённого
        маркера остаётся неизвестным. Частоты навыков и зарплатные выборки пересчитываются для
        выбранного среза.
      </p>
      {selected && selected.evidence.markers.length > 0 ? (
        <p className="ps-note">
          Маркеры в опубликованных названиях:{' '}
          {selected.evidence.markers
            .slice(0, 8)
            .map((marker) => salaryDisplayLabel(marker, 24))
            .join(', ')}
          .
        </p>
      ) : null}
    </section>
  );
}

export function SalaryMarketPage(props: SalaryMarketPageProps) {
  const visible = selectSalaryGrade(props.snapshot, props.grade);
  return (
    <>
      <main id="main" tabIndex={-1} className="ps-wrap ps-page sm-page">
        <MarketHeading snapshot={visible} />
        <MarketGrades snapshot={props.snapshot} grade={props.grade} />
        <MarketSalaries {...props} snapshot={visible} />
        <MarketSkills {...props} snapshot={visible} />
        <MarketMethodology snapshot={visible} />
        <CompareResumeCta />
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
      <main id="main" tabIndex={-1} className="ps-wrap ps-page sm-page">
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
        <CompareResumeCta />
      </main>
    </>
  );
}
