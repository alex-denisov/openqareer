import { useState, type ReactNode } from 'react';
import { ActionDock, Button, Icon, InfoTip, Link, SegControl, type SegOption } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { BlockError } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { pageAttrs } from './careerPaths';
import { loadRelocation, type RelocationData, type RelocationPlace } from './relocationApi';
import { placesTitle } from './relocationModel';
import { familyOf, scenarioKey } from './relocationCostsApi';
import type { CostKey } from './relocationCostsModel';
import { choiceKey, putPlaces, withSkip } from './relocationPlacesApi';
import { RelocationPlacesDialog } from './RelocationPlacesDialog';
import { RelocationRow, type RowContext } from './RelocationRow';
import { RelocationWhoDialog } from './RelocationWhoDialog';

const TIP =
  'Вакансии — доски вакансий и сайты компаний в городах страны. Доход до налогов — середина вилок вакансий страны или города, выборка и дата — у строки «Доход до налогов». Налог и взносы — по шкалам страны на текущий год. Траты по разделам вводите вы; раздел «Не про меня» в остаток не входит. Это не юридическая консультация.';

function Loading() {
  return (
    <div className="st-var is-wait col-wide" role="status" aria-busy="true">
      <span>Считаем страну…</span>
      <ul className="ls-skel c12-skel" aria-label="Загрузка">
        <li className="c12-skel-row">
          <span className="ls-bar w4" />
          <span className="ls-bar w1" />
        </li>
      </ul>
    </div>
  );
}

type Scope = 'all' | 'inside' | 'abroad';

const SCOPES: readonly SegOption<Scope>[] = [
  { value: 'all', label: 'Все' },
  { value: 'inside', label: 'Внутри страны' },
  { value: 'abroad', label: 'Другие страны' },
];

function useSkips(data: RelocationData) {
  const [choices, setChoices] = useState(data.choices);
  const skippedOf = (key: string) =>
    choices.find((choice) => choiceKey(choice) === key)?.skipped ?? [];
  const onSkip = (key: string) => async (section: CostKey, skip: boolean) => {
    const saved = await putPlaces(withSkip(choices, key, section, skip));
    setChoices(saved.places);
  };
  return { skippedOf, onSkip };
}

function PlaceList(props: {
  readonly id: string;
  readonly title: string;
  readonly places: readonly RelocationPlace[];
  readonly firstOpen: boolean;
  readonly context: (place: RelocationPlace) => RowContext;
}) {
  if (props.places.length === 0) return null;
  return (
    <>
      <h3 className="mod-title" id={props.id}>
        {props.title}
      </h3>
      <ul className="rows exp-rows rl-rows" aria-labelledby={props.id}>
        {props.places.map((place, index) => (
          <RelocationRow
            place={place}
            open={props.firstOpen && index === 0}
            context={props.context(place)}
            key={place.key}
          />
        ))}
      </ul>
    </>
  );
}

function Lists(props: {
  readonly abroad: readonly RelocationPlace[];
  readonly inside: readonly RelocationPlace[];
  readonly context: (place: RelocationPlace) => RowContext;
}) {
  const [scope, setScope] = useState<Scope>('all');
  const { abroad, inside, context } = props;
  return (
    <>
      {abroad.length > 0 && inside.length > 0 ? (
        <fieldset className="decide">
          <SegControl
            label="Куда смотреть"
            name="rl-seg"
            value={scope}
            options={SCOPES}
            onChange={setScope}
          />
        </fieldset>
      ) : null}
      {scope !== 'inside' ? (
        <PlaceList
          id="rl-abroad"
          title="В другие страны"
          places={abroad}
          firstOpen
          context={context}
        />
      ) : null}
      {scope !== 'abroad' ? (
        <PlaceList
          id="rl-inside"
          title="Внутри страны"
          places={inside}
          firstOpen={abroad.length === 0 || scope === 'inside'}
          context={context}
        />
      ) : null}
    </>
  );
}

function Head(props: {
  readonly title: string;
  readonly role: string | null;
  readonly onPlaces: () => void;
}) {
  return (
    <>
      <div className="lead-head">
        <h2 className="lead-title is-long" id="rl-title">
          {props.title}
        </h2>
        <InfoTip label="Как посчитано" text={TIP} />
      </div>
      {props.role ? <p className="lead-sub">{props.role}</p> : null}
      {/* «Изменить места» — вторичным действием, не в главной позиции (B645 c06). */}
      <button className="row-act" type="button" onClick={props.onPlaces}>
        <Icon name="pin" />
        Изменить места
      </button>
    </>
  );
}

interface PlacesProps {
  readonly data: RelocationData;
  readonly reload: () => void;
  /** Правая колонка: стоит между колонкой мест и полосой действия. */
  readonly aside: ReactNode;
}

function Places({ data, reload, aside }: PlacesProps) {
  const [who, setWho] = useState(false);
  const [editPlaces, setEditPlaces] = useState(false);
  const family = familyOf(data.questionnaire?.profile ?? null);
  const skips = useSkips(data);
  const context = (place: RelocationPlace): RowContext => ({
    questionnaire: data.questionnaire,
    scenario: data.scenarios.get(
      place.kind === 'city' ? scenarioKey('RU', place.name) : place.code,
    ),
    family,
    onWho: () => setWho(true),
    onConsent: reload,
    skipped: skips.skippedOf(place.key),
    onSkip: skips.onSkip(place.key),
  });
  const abroad = data.places.filter((place) => place.kind === 'country');
  const inside = data.places.filter((place) => place.kind === 'city');
  return (
    <>
      <div className="col">
        <section className="lead" aria-labelledby="rl-title">
          <Head
            title={placesTitle(abroad.length, inside.length)}
            role={data.role ? (data.titlesRu[data.role] ?? data.role) : null}
            onPlaces={() => setEditPlaces(true)}
          />
          <RelocationWhoDialog
            key={JSON.stringify(family)}
            open={who}
            onClose={() => setWho(false)}
            questionnaire={data.questionnaire}
            family={family}
            onSaved={reload}
          />
          <PlacesDialog
            data={data}
            open={editPlaces}
            onClose={() => setEditPlaces(false)}
            reload={reload}
          />
          <Lists abroad={abroad} inside={inside} context={context} />
        </section>
      </div>
      {aside}
      <WhoDock onWho={() => setWho(true)} />
    </>
  );
}

function PlacesDialog(props: {
  readonly data: RelocationData;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly reload: () => void;
}) {
  return (
    <RelocationPlacesDialog
      key={props.data.choices.map(choiceKey).join()}
      open={props.open}
      onClose={props.onClose}
      choices={props.data.choices}
      cities={props.data.cities}
      questionnaire={props.data.questionnaire}
      onSaved={props.reload}
    />
  );
}

/**
 * Главное действие — полоса act-dock на всю ширину страницы, как в макете c06 (B645):
 * на 1440 у низа окна, на 390 над навигацией во всю ширину.
 */
function WhoDock({ onWho }: { readonly onWho: () => void }) {
  return (
    <ActionDock
      kind="auto"
      primary={
        <Button variant="primary" icon="question" onClick={onWho}>
          Уточнить: кто едет и бюджет
        </Button>
      }
    />
  );
}

function Companies({ count }: { readonly count: number | null }) {
  if (!count) return null;
  return (
    <section className="mod" aria-labelledby="rl-co">
      <h3 className="mod-title" id="rl-co">
        Компании, которые оплачивают релокацию
      </h3>
      <div className="actions">
        <Link className="btn" to={`${buildNodePath('v10')}?relocation=true`}>
          <Icon name="building" />
          Смотреть компании · <span className="num">{count}</span>
        </Link>
      </div>
    </section>
  );
}

/** C06 «Релокация»: страны для переезда — доход на руки, налоги и право работать. */
export function RelocationScreen({ node }: { readonly node: B640Node }) {
  const load = useLoad(loadRelocation);
  return (
    <div className="page two" {...pageAttrs(node)}>
      {load.state === 'loading' ? (
        <Loading />
      ) : load.state === 'error' ? (
        <div className="col">
          <BlockError text="Не удалось посчитать страны." onRetry={load.retry} />
        </div>
      ) : (
        <Places
          data={load.data}
          reload={load.retry}
          aside={
            <div className="col">
              <Companies count={load.data.companies} />
            </div>
          }
        />
      )}
    </div>
  );
}
