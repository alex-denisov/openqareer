import { ArrowRight } from '@phosphor-icons/react';
import { useState } from 'react';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { RoleMarketMap } from '../career-map/roleMarketMap';
import { pluralRu } from '../../../shared/pluralRu';
import type { ProposedRole, RoleConfirmation } from '../../../shared/roleProposals';
import type { CareerCabinetView } from './cabinetViews';

/**
 * «Роли и рынок» — карта ролей и выборка вакансий за ней (B104, B118).
 *
 * Движок карты был написан и покрыт тестами, но в «Пульт» не попал, а рынку он
 * отдавал пустые наблюдения — поэтому вошедший кандидат не видел ни одной
 * гипотезы роли. Теперь наблюдения берутся из собранного пула, и каждое число
 * на экране называет свою выборку, дату наблюдения и источник.
 *
 * Маленькая выборка — это отказ, а не маленькое число: одна компания со своим
 * шаблоном требований переворачивает картину, и показывать её как рынок
 * нечестно.
 */
/**
 * Выбор роли в «Стратегию» — одна вещь, и передаётся одной (B180, срез 2).
 *
 * Отдельными пропсами это расползалось по четырём сигнатурам подряд.
 */
export interface RoleChoiceActions {
  /** Роль, уже выбранная стратегией: её видно на месте, а не в другой панели. */
  readonly chosenTitle?: string;
  readonly saving?: boolean;
  /**
   * Причина обязательна только при смене уже выбранной роли: смена обнуляет
   * накопленную воронку.
   */
  readonly onChoose?: (title: string, reason?: string) => void;
}

export function RolesMarketPanel({
  journey,
  proposedRoles,
  poolComplete = true,
  poolTotal = 0,
  choice,
  onNavigate,
}: {
  readonly journey?: CareerJourney;
  /**
   * Роли, названные моделью по фактам кандидата, с меткой о том, что про них
   * говорит пул вакансий (B180, срез 1в).
   */
  readonly proposedRoles?: readonly ProposedRole[];
  /** Пул читается страницами: выборка по половине пула — не выборка по пулу. */
  readonly poolComplete?: boolean;
  readonly poolTotal?: number;
  readonly choice?: RoleChoiceActions;
  readonly onNavigate: (view: CareerCabinetView) => void;
}) {
  const map = journey?.roleMarketMap;
  // Роли, названные моделью, от карты журнала не зависят: на проде ранний
  // выход по `roleMarketMap` прятал панель целиком, хотя маршрут отдавал пять
  // ролей (B180). Пусто — только когда нечего показать вовсе.
  if (!map && !proposedRoles) return null;
  const roles = map?.roles.slice(0, 3) ?? [];
  const markets = map?.markets ?? [];

  return (
    <section className="career-home-panel career-roles-market" aria-labelledby="career-roles-title">
      <header>
        <h3 id="career-roles-title">Роли и рынок</h3>
        <span className="career-cabinet-tag">по вашему пулу</span>
      </header>

      {proposedRoles ? (
        <ProposedRoleList roles={proposedRoles} choice={choice} />
      ) : (
        <RoleHypotheses roles={roles} />
      )}

      {markets.length ? <MarketSamples markets={markets} /> : null}

      {!poolComplete && observedCount(markets) > 0 ? (
        <p className="career-cabinet-tag">
          Пул ещё дочитывается: прочитано {observedCount(markets)} из {poolTotal} — числа
          вырастут.
        </p>
      ) : null}

      <button
        type="button"
        className="career-quiet-button"
        onClick={() => onNavigate('opportunities')}
      >
        Открыть вакансии за этими числами <ArrowRight size={15} />
      </button>
    </section>
  );
}

/**
 * Роли, названные моделью по резюме, с тем, что про них говорит пул.
 *
 * Роль без вакансий с экрана **не убирается**: решение владельца 2026-09-03 —
 * «если в пуле вакансий таких нет, не нужно обесценивать ответ LLM, нужно лишь
 * сообщить, что пока таких вакансий не найдено». Поэтому список делится на два
 * блока, и нижний называет своё состояние и следующий шаг, а не молчит.
 */
function ProposedRoleList({
  roles,
  choice,
}: {
  readonly roles: readonly ProposedRole[];
  readonly choice?: RoleChoiceActions;
}) {
  if (!roles.length) {
    return (
      <p className="career-home-empty">
        Роль ещё не названа: нужны подтверждённые факты о вашем опыте, по которым
        её можно назвать.
      </p>
    );
  }
  const confirmed = roles.filter((role) => role.confirmation.state === 'observed');
  const pending = roles.filter((role) => role.confirmation.state !== 'observed');

  return (
    <>
      {confirmed.length ? (
        <ol className="career-roles-list">
          {confirmed.map((role) => (
            <RoleRow key={role.id} role={role} choice={choice} />
          ))}
        </ol>
      ) : null}

      {pending.length ? (
        <div className="career-roles-pending">
          <p className="career-cabinet-tag">Пока не найдено в наших источниках</p>
          <ol className="career-roles-list">
            {pending.map((role) => (
              <RoleRow key={role.id} role={role} choice={choice} />
            ))}
          </ol>
          <p className="career-home-empty">
            Это названия ролей по вашему опыту, а не наблюдение рынка. Чтобы они
            подтвердились, нужен шире фильтр, больше источников или ещё один сбор.
          </p>
        </div>
      ) : null}
    </>
  );
}

function RoleRow({
  role,
  choice,
}: {
  readonly role: ProposedRole;
  readonly choice?: RoleChoiceActions;
}) {
  const isChosen = sameTitle(choice?.chosenTitle, role.title);
  return (
    <li>
      <strong>{role.title}</strong>
      {isChosen ? <span className="career-cabinet-tag">ваша роль</span> : null}
      <small>{originLabel(role)}</small>
      <ConfirmationLine confirmation={role.confirmation} />
      {role.confirmation.state === 'observed' && role.confirmation.repeatedRequirements.length ? (
        <small>
          Повторяются: {role.confirmation.repeatedRequirements.slice(0, 4).join(', ')}
        </small>
      ) : null}
      {choice?.onChoose && !isChosen ? (
        <ChooseRoleAction title={role.title} choice={choice} onChoose={choice.onChoose} />
      ) : null}
    </li>
  );
}

/**
 * Выбор роли, а при смене — и его причина.
 *
 * Смена роли обнуляет накопленную воронку и уничтожает сравнимость данных,
 * поэтому кандидат обязан увидеть, что меняет, и назвать почему. Первый выбор
 * ничего не обнуляет и причины не требует.
 */
function ChooseRoleAction({
  title,
  choice,
  onChoose,
}: {
  readonly title: string;
  readonly choice: RoleChoiceActions;
  readonly onChoose: (title: string, reason?: string) => void;
}) {
  const [explaining, setExplaining] = useState(false);
  const saving = Boolean(choice.saving);

  if (!choice.chosenTitle) {
    return (
      <button
        type="button"
        className="career-quiet-button"
        disabled={saving}
        onClick={() => onChoose(title)}
      >
        Выбрать эту роль
      </button>
    );
  }

  if (!explaining) {
    return (
      <button
        type="button"
        className="career-quiet-button"
        disabled={saving}
        onClick={() => setExplaining(true)}
      >
        Сменить роль на эту
      </button>
    );
  }

  return <ChangeRoleForm title={title} saving={saving} onChoose={onChoose} />;
}

/** Причина смены — не формальность: она остаётся в истории решений навсегда. */
function ChangeRoleForm({
  title,
  saving,
  onChoose,
}: {
  readonly title: string;
  readonly saving: boolean;
  readonly onChoose: (title: string, reason?: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="career-roles-change">
      <label htmlFor={`role-change-${title}`}>
        Смена роли обнулит накопленную воронку. Почему меняете?
      </label>
      <textarea
        id={`role-change-${title}`}
        value={reason}
        rows={2}
        maxLength={2_000}
        onChange={(event) => setReason(event.target.value)}
      />
      <button
        type="button"
        className="career-quiet-button"
        disabled={saving || reason.trim().length === 0}
        onClick={() => onChoose(title, reason.trim())}
      >
        Сменить роль
      </button>
    </div>
  );
}

function sameTitle(left: string | undefined, right: string): boolean {
  return Boolean(left) && left?.trim().toLowerCase() === right.trim().toLowerCase();
}

/** Имя роли и наблюдение рынка — разные вещи, и метка не даёт их спутать. */
function originLabel(role: ProposedRole): string {
  return role.origin === 'model'
    ? `названо по вашему опыту: ${role.reason ?? ''}`.trim()
    : 'названо рынком: так эту роль называют в вакансиях';
}

function ConfirmationLine({ confirmation }: { readonly confirmation: RoleConfirmation }) {
  if (confirmation.state === 'not-found') {
    return <small>Вакансий по ней в собранном пуле пока нет.</small>;
  }
  if (confirmation.state === 'too-few') {
    return (
      <small>
        Найдено {confirmation.sampleSize} — рано делать выводы, нужна выборка от восьми.
      </small>
    );
  }
  return (
    <small>
      {pluralRu(confirmation.sampleSize, ['вакансия', 'вакансии', 'вакансий'])} ·{' '}
      {observationWindow(confirmation)} · {sourceSummary(confirmation)}
    </small>
  );
}

const SOURCE_NAMES: Record<string, string> = {
  hh: 'hh.ru',
  trudvsem: 'ТрудВсем',
  remotive: 'Remotive',
  telegram: 'Telegram-каналы',
};

function sourceSummary(role: { sources: ReadonlyArray<{ source: string; count: number }> }): string {
  return role.sources
    .slice(0, 3)
    .map((entry) => `${SOURCE_NAMES[entry.source] ?? entry.source} ${entry.count}`)
    .join(', ');
}

function observationWindow(role: { observedFrom: string; observedTo: string }): string {
  const from = formatDay(role.observedFrom);
  const to = formatDay(role.observedTo);
  return from === to ? `наблюдение ${to}` : `наблюдение ${from} — ${to}`;
}

/** До трёх гипотез роли: название, на чём стоит и чего не хватает. */
function RoleHypotheses({ roles }: { readonly roles: RoleMarketMap['roles'] }) {
  if (!roles.length) {
    return (
      <p className="career-home-empty">
        Роль ещё не названа: гипотезы строятся из ваших фактов и вакансий пула.
      </p>
    );
  }
  return (
    <ol className="career-roles-list">
      {roles.map((role) => (
        <li key={role.id}>
          <strong>{role.title}</strong>
          <small>{role.basis}</small>
          {role.gaps.length ? <small className="is-gap">{role.gaps[0]}</small> : null}
        </li>
      ))}
    </ol>
  );
}

/** Сколько записей пула вообще попало хоть в одну выборку. */
function observedCount(markets: RoleMarketMap['markets']): number {
  return markets.reduce((sum, market) => sum + market.sampleSize, 0);
}

/** Выборка рынка: число, дата наблюдения и повторяющиеся требования. */
function MarketSamples({ markets }: { readonly markets: RoleMarketMap['markets'] }) {
  return (
    <ul className="career-market-list">
      {markets.map((market) => (
        <li key={market.id}>
          <span>{market.label}</span>
          {market.certainty === 'fact' && market.lastObservedAt ? (
            <span className="career-market-sample-note">
              <strong>
                {pluralRu(market.sampleSize, ['вакансия', 'вакансии', 'вакансий'])}
              </strong>{' '}
              · наблюдение{' '}
              {formatDay(market.lastObservedAt)}
            </span>
          ) : (
            <span className="career-market-sample-note is-unknown">
              Выборки не хватает{market.sampleSize > 0 ? `: собрано ${market.sampleSize}` : ''}
            </span>
          )}
          {market.certainty === 'fact' && market.repeatedRequirements.length ? (
            <small>Повторяются: {market.repeatedRequirements.slice(0, 5).join(', ')}</small>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
    new Date(value),
  );
}
