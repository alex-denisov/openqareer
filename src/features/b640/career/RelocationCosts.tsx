import { Fragment, useState } from 'react';
import type { SavedRelocationScenario } from '../../../../shared/relocationScenario';
import type { RelocationQuestionnaireResponse } from '../../relocation/relocationApi';
import { Icon } from '../kit';
import { RelocationCostEdit } from './RelocationCostEdit';
import { costValues, saveCosts, type CostsTarget } from './relocationCostsApi';
import {
  COST_SECTIONS,
  costsSummary,
  whoLabel,
  type CostKey,
  type CostValues,
} from './relocationCostsModel';
import { formatMoney } from './relocationModel';
import { ConsentCheck, useConsentGate } from './RelocationWhoDialog';

type Editing = { readonly kind: 'edit'; readonly key: CostKey } | { readonly kind: 'add' } | null;

function useCosts(
  target: CostsTarget,
  scenario: SavedRelocationScenario | undefined,
  questionnaire: RelocationQuestionnaireResponse | null,
  onConsent: () => void,
) {
  const [saved, setSaved] = useState(scenario);
  const [values, setValues] = useState<CostValues>(() => costValues(scenario));
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const consent = useConsentGate(questionnaire);
  const save = async (key: CostKey, amount: number) => {
    setBusy(true);
    setFailed(false);
    try {
      if (!questionnaire?.consent.granted) {
        await consent.ensure();
        onConsent();
      }
      const next = { ...values, [key]: amount };
      setSaved(await saveCosts(target, next, saved));
      setValues(next);
      setEditing(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const open = (next: Editing) => {
    setEditing(next);
    setFailed(false);
  };
  return { values, editing, busy, failed, consent, save, open };
}

function Summary({
  values,
  net,
  currency,
}: {
  readonly values: CostValues;
  readonly net: number;
  readonly currency: string;
}) {
  const summary = costsSummary(values, net);
  if (summary.remaining === null) return null;
  return (
    <dl className="rl-calc" aria-label="Итог трат">
      <div className="rl-line is-sum">
        <dt>Остаётся на жизнь</dt>
        <dd className="rl-amt num">{formatMoney(summary.remaining, currency)} в месяц</dd>
      </div>
      {summary.startCash !== null ? (
        <div className="rl-line is-sum">
          <dt>Нужно на старте</dt>
          <dd className="rl-amt num">{formatMoney(summary.startCash, currency)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

type Costs = ReturnType<typeof useCosts>;

function CostRow(props: {
  readonly section: (typeof COST_SECTIONS)[number];
  readonly amount: number;
  readonly currency: string;
  readonly onEdit: () => void;
}) {
  return (
    <li className="rl-cost">
      <span className="rl-cost-t">{props.section.label}</span>
      <span className="rl-cost-a">
        <button className="rl-cost-v num" type="button" onClick={props.onEdit}>
          {formatMoney(props.amount, props.currency)}
          {props.section.once ? '' : ' в месяц'}
        </button>
      </span>
    </li>
  );
}

function AddRow({ missing, onAdd }: { readonly missing: number; readonly onAdd: () => void }) {
  return (
    <li className="rl-cost">
      <span className="rl-cost-t">Расходы</span>
      <span className="rl-cost-a">
        <button className="row-act" type="button" onClick={onAdd}>
          <Icon name="plus" />
          Добавить расходы · <span className="num">{missing}</span>
        </button>
      </span>
    </li>
  );
}

function CostList({ costs, target }: { readonly costs: Costs; readonly target: CostsTarget }) {
  const missing = COST_SECTIONS.filter((section) => costs.values[section.key] === undefined);
  const edit = (sections: typeof COST_SECTIONS, initial?: number) => (
    <RelocationCostEdit
      sections={sections}
      initial={initial}
      currency={target.currency}
      busy={costs.busy}
      failed={costs.failed}
      blocked={!costs.consent.accepted}
      onSave={(key, amount) => void costs.save(key, amount)}
      onCancel={() => costs.open(null)}
    />
  );
  const adding = costs.editing?.kind === 'add';
  return (
    <ul className="rl-costs" aria-label={`Траты: ${target.countryName}`}>
      {COST_SECTIONS.map((section) => {
        const amount = costs.values[section.key];
        if (amount === undefined) return null;
        const editing = costs.editing?.kind === 'edit' && costs.editing.key === section.key;
        return editing ? (
          <Fragment key={section.key}>{edit([section], amount)}</Fragment>
        ) : (
          <CostRow
            key={section.key}
            section={section}
            amount={amount}
            currency={target.currency}
            onEdit={() => costs.open({ kind: 'edit', key: section.key })}
          />
        );
      })}
      {missing.length > 0 && adding ? edit(missing) : null}
      {missing.length > 0 && !adding ? (
        <AddRow missing={missing.length} onAdd={() => costs.open({ kind: 'add' })} />
      ) : null}
    </ul>
  );
}

/** «Кто едет» и траты страны по разделам; итог — когда заполнены все разделы. */
export function RelocationCosts(props: {
  readonly target: CostsTarget;
  readonly net: number;
  readonly scenario: SavedRelocationScenario | undefined;
  readonly questionnaire: RelocationQuestionnaireResponse | null;
  readonly onWho: () => void;
  readonly onConsent: () => void;
}) {
  const { target } = props;
  const costs = useCosts(target, props.scenario, props.questionnaire, props.onConsent);
  return (
    <>
      <p className="rl-who">
        <span>Кто едет: {whoLabel(target.family)}</span>
        <button className="row-act" type="button" onClick={props.onWho}>
          Изменить
        </button>
      </p>
      <CostList costs={costs} target={target} />
      {costs.editing ? (
        <ConsentCheck
          questionnaire={props.questionnaire}
          accepted={costs.consent.accepted}
          onChange={costs.consent.setAccepted}
        />
      ) : null}
      <Summary values={costs.values} net={props.net} currency={target.currency} />
    </>
  );
}
