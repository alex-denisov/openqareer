import { useState } from 'react';
import { Button, Icon, InfoTip, Link } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { BlockError } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { pageAttrs } from './careerPaths';
import { loadRelocation, type RelocationData } from './relocationApi';
import { placesTitle } from './relocationModel';
import { familyOf } from './relocationCostsApi';
import { RelocationRow } from './RelocationRow';
import { RelocationWhoDialog } from './RelocationWhoDialog';

const TIP =
  'Вакансии — доски вакансий и сайты компаний в городах страны. Доход до налогов — середина вилок вакансий страны, выборка и дата — у строки «Доход до налогов». Налог и взносы — по шкалам страны на текущий год. Это не юридическая консультация.';

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

function Places({ data, reload }: { readonly data: RelocationData; readonly reload: () => void }) {
  const [who, setWho] = useState(false);
  const family = familyOf(data.questionnaire?.profile ?? null);
  const context = (code: string) => ({
    questionnaire: data.questionnaire,
    scenario: data.scenarios.get(code),
    family,
    onWho: () => setWho(true),
    onConsent: reload,
  });
  return (
    <section className="lead" aria-labelledby="rl-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="rl-title">
          {placesTitle(data.places.length)}
        </h2>
        <InfoTip label="Как посчитано" text={TIP} />
      </div>
      {data.role ? <p className="lead-sub">{data.role}</p> : null}
      <div className="actions">
        <Button variant="primary" icon="question" onClick={() => setWho(true)}>
          Уточнить, кто едет
        </Button>
      </div>
      <RelocationWhoDialog
        key={JSON.stringify(family)}
        open={who}
        onClose={() => setWho(false)}
        questionnaire={data.questionnaire}
        family={family}
        onSaved={reload}
      />
      <h3 className="mod-title" id="rl-abroad">
        В другие страны
      </h3>
      <ul className="rows exp-rows rl-rows" aria-labelledby="rl-abroad">
        {data.places.map((place, index) => (
          <RelocationRow
            place={place}
            open={index === 0}
            context={context(place.code)}
            key={place.code}
          />
        ))}
      </ul>
    </section>
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
        <>
          <div className="col">
            <Places data={load.data} reload={load.retry} />
          </div>
          <div className="col">
            <Companies count={load.data.companies} />
          </div>
        </>
      )}
    </div>
  );
}
