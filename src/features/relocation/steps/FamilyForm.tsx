import type { FamilyStep } from '../../../../shared/relocationQuestionnaire';
import type { RelocationQuestionnaireStepFormProps } from '../RelocationQuestionnaireSteps';
import { RelocationFormField } from '../RelocationFormControls';

type Household = 'alone' | 'partner' | 'partner_children';
type Priority = NonNullable<FamilyStep['priorities']>[number];

const HOUSEHOLD_OPTIONS: readonly [Household, string][] = [
  ['alone', 'Один'],
  ['partner', 'С партнёром'],
  ['partner_children', 'С партнёром и детьми'],
];

const TIMEFRAME_OPTIONS: readonly [FamilyStep['relocationTimeframe'], string][] = [
  ['under_two_weeks', 'Не больше 2 недель'],
  ['under_three_months', 'До 3 месяцев'],
  ['over_twelve_months', 'Дольше, если надёжно'],
];

const PRIORITY_OPTIONS: readonly [Priority, string][] = [
  ['permanent_residence', 'Путь к ПМЖ'],
  ['citizenship', 'Гражданство'],
  ['partner_work', 'Возможность работать партнёру'],
];

function household(family: FamilyStep): Household | null {
  if (family.partnerStatus === 'no_partner') return 'alone';
  if (family.partnerStatus !== 'has_partner') return null;
  return (family.childrenCount ?? 0) > 0 ? 'partner_children' : 'partner';
}

function householdChange(value: Household, family: FamilyStep): Partial<FamilyStep> {
  if (value === 'alone') return { partnerStatus: 'no_partner', childrenCount: 0 };
  if (value === 'partner') return { partnerStatus: 'has_partner', childrenCount: 0 };
  return { partnerStatus: 'has_partner', childrenCount: Math.max(family.childrenCount ?? 0, 1) };
}

/** Mockup 15 `i3`: who moves, how long to wait, what matters later. Nothing is preselected. */
export function FamilyForm({ profile, onProfileChange }: RelocationQuestionnaireStepFormProps) {
  const family = profile.family;
  const update = (change: Partial<FamilyStep>) => onProfileChange({ ...profile, family: { ...family, ...change } });
  const current = household(family);
  const priorities = family.priorities ?? [];
  const togglePriority = (item: Priority, checked: boolean) =>
    update({ priorities: checked ? [...priorities, item] : priorities.filter((value) => value !== item) });
  return (
    <div className="career-relocation-step-content">
      <fieldset className="career-relocation-step-card career-relocation-options">
        <legend>С кем планируете переезд</legend>
        {HOUSEHOLD_OPTIONS.map(([option, label]) => (
          <label key={option}>
            <input type="radio" name="relocation-household" checked={current === option} onChange={() => update(householdChange(option, family))} />
            {label}
          </label>
        ))}
      </fieldset>
      {current === 'partner_children' ? (
        <RelocationFormField id="relocation-children-count" label="Сколько детей переезжает">
          <input
            id="relocation-children-count"
            type="number"
            min="1"
            max="10"
            value={family.childrenCount ?? ''}
            onChange={(event) => update({ childrenCount: event.target.value === '' ? undefined : Number(event.target.value) })}
          />
        </RelocationFormField>
      ) : null}
      <TimeframeGroup value={family.relocationTimeframe} onChange={(relocationTimeframe) => update({ relocationTimeframe })} />
      <fieldset className="career-relocation-step-card career-relocation-options">
        <legend>Что важно в перспективе</legend>
        {PRIORITY_OPTIONS.map(([option, label]) => (
          <label key={option}>
            <input type="checkbox" checked={priorities.includes(option)} onChange={(event) => togglePriority(option, event.target.checked)} />
            {label}
          </label>
        ))}
      </fieldset>
    </div>
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
