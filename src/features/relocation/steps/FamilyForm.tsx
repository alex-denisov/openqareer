import type { FamilyStep } from '../../../../shared/relocationQuestionnaire';
import type { RelocationQuestionnaireStepFormProps } from '../RelocationQuestionnaireSteps';
import { RelocationFormField } from '../RelocationFormControls';

const PARTNER_OPTIONS: readonly [FamilyStep['partnerStatus'], string][] = [
  ['no_partner', 'Один'], ['has_partner', 'С партнёром'], ['undecided', 'Не решил'], ['unknown', 'Не указано'],
];

const TIMEFRAME_OPTIONS: readonly [FamilyStep['relocationTimeframe'], string][] = [
  ['under_three_months', 'Не больше трёх месяцев'],
  ['three_to_six_months', 'От трёх до шести месяцев'],
  ['six_to_twelve_months', 'От шести до двенадцати месяцев'],
  ['over_twelve_months', 'Дольше, если надёжно'],
  ['unknown', 'Не указано'],
];

export function FamilyForm({ profile, onProfileChange }: RelocationQuestionnaireStepFormProps) {
  const update = (change: Partial<FamilyStep>) => onProfileChange({ ...profile, family: { ...profile.family, ...change } });
  return (
    <div className="career-relocation-step-content">
      <PartnerGroup value={profile.family.partnerStatus} onChange={(partnerStatus) => update({ partnerStatus })} />
      <TimeframeGroup value={profile.family.relocationTimeframe} onChange={(relocationTimeframe) => update({ relocationTimeframe })} />
      <FamilyPlanField value={profile.family.familyMovePlan} onChange={(familyMovePlan) => update({ familyMovePlan })} />
      <RelocationFormField id="relocation-children-count" label="Сколько детей переезжает">
        <input
          id="relocation-children-count"
          type="number"
          min="0"
          max="10"
          value={profile.family.childrenCount ?? ''}
          onChange={(event) => update({ childrenCount: event.target.value === '' ? undefined : Number(event.target.value) })}
        />
      </RelocationFormField>
    </div>
  );
}

function PartnerGroup({
  value,
  onChange,
}: {
  readonly value: FamilyStep['partnerStatus'];
  readonly onChange: (value: FamilyStep['partnerStatus']) => void;
}) {
  return (
    <fieldset className="career-relocation-step-card career-relocation-options">
      <legend>С кем планируете переезд</legend>
      {PARTNER_OPTIONS.map(([option, label]) => (
        <label key={option}>
          <input type="radio" name="relocation-partner" checked={value === option} onChange={() => onChange(option)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function TimeframeGroup({
  value,
  onChange,
}: {
  readonly value: FamilyStep['relocationTimeframe'];
  readonly onChange: (value: FamilyStep['relocationTimeframe']) => void;
}) {
  return (
    <fieldset className="career-relocation-step-card career-relocation-options">
      <legend>Сколько готовы ждать оформление</legend>
      {TIMEFRAME_OPTIONS.map(([option, label]) => (
        <label key={option}>
          <input type="radio" name="relocation-timeframe" checked={value === option} onChange={() => onChange(option)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function FamilyPlanField({
  value,
  onChange,
}: {
  readonly value: FamilyStep['familyMovePlan'];
  readonly onChange: (value: FamilyStep['familyMovePlan']) => void;
}) {
  return (
    <RelocationFormField id="relocation-family-plan" label="План переезда семьи">
      <select id="relocation-family-plan" value={value} onChange={(event) => onChange(event.target.value as FamilyStep['familyMovePlan'])}>
        <option value="together">Вместе</option>
        <option value="later">Позже</option>
        <option value="not_applicable">Не относится</option>
        <option value="undecided">Не решил</option>
      </select>
    </RelocationFormField>
  );
}
