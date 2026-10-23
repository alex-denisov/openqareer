import React from 'react';
import { salaryRolePath } from '../../../shared/salaryMarketPublic';
export { salaryRolePath } from '../../../shared/salaryMarketPublic';
export { salarySnapshotIndexable } from '../../../shared/salaryMarketSnapshot';
import { MIN_SALARY_MARKET_SAMPLE } from '../../../shared/salaryMarketSnapshot';
import type {
  SalaryMarketIndexEntry,
  SalaryMarketSnapshot,
} from '../../../shared/salaryMarketSnapshot';

export const SALARY_MARKET_TITLE = 'Зарплаты и навыки по должностям | openqareer';
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
  return snapshot ? `Зарплаты и навыки: ${snapshot.roleLabel} | openqareer` : SALARY_MARKET_TITLE;
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
}
function MarketHeading({ snapshot }: Pick<SalaryMarketPageProps, 'snapshot'>) {
  return (
    <header className="sm-heading">
      <nav className="ps-crumbs" aria-label="Навигационная цепочка">
        <a href="/">Главная</a>
        <span>/</span>
        <a href="/salaries">Зарплаты и навыки</a>
        <span>/</span>
        <span>{snapshot?.roleLabel ?? 'Нет данных'}</span>
      </nav>
      <p className="ps-label">Данные публичного каталога</p>
      <h1>
        {snapshot ? (
          <>
            Зарплаты и навыки
            <br />
            {snapshot.roleLabel}
          </>
        ) : (
          'Зарплаты и навыки по должностям'
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
function MarketSkills({ snapshot }: Pick<SalaryMarketPageProps, 'snapshot'>) {
  return (
    <section className="sm-skills" aria-labelledby="skills-title">
      <div className="sm-section-heading">
        <h2 id="skills-title">Навыки в вакансиях</h2>
        <span className="ps-soft">До 15 самых частых</span>
      </div>
      {snapshot && snapshot.sampleSize >= MIN_SALARY_MARKET_SAMPLE && snapshot.skills.length > 0 ? (
        <ol className="sm-skill-list">
          {snapshot.skills.map((skill) => (
            <li key={skill.name}>
              <span>{skill.name}</span>
              <span>
                <b>{skill.frequency.toLocaleString('ru-RU')}%</b>{' '}
                <small>
                  {skill.count.toLocaleString('ru-RU')} из{' '}
                  {snapshot.sampleSize.toLocaleString('ru-RU')}
                </small>
              </span>
              <meter
                min="0"
                max="100"
                value={skill.frequency}
                aria-label={`${skill.name}: доля вакансий`}
              >
                {skill.frequency}%
              </meter>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sm-unavailable">
          Недостаточно опубликованных наблюдений для рейтинга навыков. Откройте каталог и сравните
          требования конкретных работодателей.
        </p>
      )}
    </section>
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
            от всех карточек с этим названием должности в выборке, включая карточки без извлечённых
            навыков. Это срез каталога, а не всего рынка.
          </p>
        </div>
        <div>
          <h3>Сравниваем только сопоставимое</h3>
          <p>
            Разные валюты, периоды и налоговые условия показаны отдельно. P50 означает середину
            упорядоченного ряда границ вилок. Неполные диапазоны и суммы без периода исключены.
            Перцентили рассчитаны методом ближайшего ранга.
          </p>
        </div>
        <div>
          <h3>Грейды и динамика пока недоступны</h3>
          <p>
            В данных нет достаточного подтверждения для общего сравнения по грейдам и кварталам.
            Individual contributor не означает junior. Историю роста зарплат и персональную оценку
            мы здесь не рассчитываем.
          </p>
        </div>
      </div>
      {snapshot?.salary.excluded ? (
        <p className="ps-note">
          Не вошли в расчёт зарплат: без периода {snapshot.salary.excluded.missingPeriod}, без
          валюты {snapshot.salary.excluded.missingCurrency}, с неполной вилкой{' '}
          {snapshot.salary.excluded.openRange}, с некорректной вилкой{' '}
          {snapshot.salary.excluded.invalidRange}, в слишком малых группах{' '}
          {snapshot.salary.excluded.belowMinimumSample}.
        </p>
      ) : null}
    </section>
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
function MarketSalaries({ snapshot, selectedGroup = 0 }: SalaryMarketPageProps) {
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
          <nav className="sm-groups" aria-label="Валюта, период оплаты и налоги">
            {groups.map((group, index) => (
              <a
                className="ps-btn"
                key={`${group.currency}-${group.period}-${group.taxBasis}`}
                href={`${path}?group=${index}`}
                aria-current={current === group ? 'true' : undefined}
              >
                {salaryGroupLabel(group)}
              </a>
            ))}
          </nav>
          <SalaryDistribution group={current} />
        </>
      ) : (
        <div className="sm-unavailable">
          <h3>Сравнимой зарплатной выборки пока нет</h3>
          <p>
            Для расчёта нужны хотя бы 5 вакансий одного названия должности с полной вилкой,
            одинаковой валютой, периодом оплаты и способом указания налогов. Мы не определяем месяц
            или год по величине суммы.
          </p>
          <a className="ps-btn" href="/vacancies">
            Посмотреть опубликованные вакансии
          </a>
        </div>
      )}
    </section>
  );
}
export function SalaryMarketPage(props: SalaryMarketPageProps) {
  return (
    <>
      <main id="main" tabIndex={-1} className="ps-wrap ps-page sm-page">
        <MarketHeading snapshot={props.snapshot} />
        <MarketSalaries {...props} />
        <MarketSkills snapshot={props.snapshot} />
        <MarketMethodology snapshot={props.snapshot} />
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
      <h1>Зарплаты и навыки по должностям</h1>
      <p className="ps-intro">
        Выберите название должности из текущего среза каталога. Мы показываем опубликованные вилки
        только там, где есть сравнимые данные.
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
              <b>{role.roleLabel}</b>
              <span>
                {role.sampleSize.toLocaleString('ru-RU')} вакансий ·{' '}
                {role.indexable
                  ? 'зарплатная выборка доступна'
                  : 'сравнимых зарплат пока недостаточно'}
              </span>
            </a>
          </li>
        ))}
    </ul>
  );
}
function DirectoryPages({ currentPage, pageCount }: { currentPage: number; pageCount: number }) {
  return (
    <>
      {' '}
      {pageCount > 1 ? (
        <nav className="sm-groups" aria-label="Страницы должностей">
          {currentPage > 1 ? (
            <a className="ps-btn" href={`/salaries?page=${currentPage - 1}`}>
              Предыдущие должности
            </a>
          ) : null}
          <span>
            Страница {currentPage} из {pageCount}
          </span>
          {currentPage < pageCount ? (
            <a className="ps-btn" href={`/salaries?page=${currentPage + 1}`}>
              Следующие должности
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
  const pageCount = Math.max(1, Math.ceil(roles.length / 20));
  const currentPage = Math.max(1, Math.min(pageCount, page));
  const visible = roles.slice((currentPage - 1) * 20, currentPage * 20);
  return (
    <>
      <main id="main" tabIndex={-1} className="ps-wrap ps-page sm-page">
        <DirectoryHeading />
        <section className="sm-skills">
          <h2>Названия должностей в текущем срезе</h2>
          {roles.length ? (
            <>
              <p className="ps-soft">
                До 100 названий должностей, сначала с доступной зарплатной выборкой. Число
                наблюдений относится к каталогу за 90 дней.
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
