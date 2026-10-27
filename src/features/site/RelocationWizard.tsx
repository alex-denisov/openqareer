import React, { useState } from 'react';
import {
  RELOCATION_ENGLISH,
  RELOCATION_FAMILY,
  RELOCATION_MAX_COUNTRIES,
  RELOCATION_PROFESSIONS,
  type RelocationAnswers,
  type RelocationEnglish,
  type RelocationFamily,
  type RelocationProfession,
} from '../../../shared/countryFit/relocationEstimate';
import { getCountryMobilityData } from '../../../shared/countryFit';
import { COUNTRY_CODES } from './countryFitScenario';
import { RELOCATION_CITIZENSHIPS, RELOCATION_CURRENCIES } from './relocationQuery';

export type RelocationDraft = Partial<Omit<RelocationAnswers, 'countries'>> & {
  readonly countries: readonly string[];
};

const CITIZENSHIP_LABELS: Readonly<Record<(typeof RELOCATION_CITIZENSHIPS)[number], string>> = {
  RU: 'Россия',
  BY: 'Беларусь',
  KZ: 'Казахстан',
  UZ: 'Узбекистан',
  AM: 'Армения',
  other: 'Другое',
};
export const PROFESSION_LABELS: Readonly<Record<RelocationProfession, string>> = {
  it: 'IT и разработка',
  finance: 'Финансы и бухгалтерия',
  engineering: 'Инженерия и производство',
  medicine: 'Медицина',
  sales: 'Продажи и маркетинг',
  other: 'Другая профессия',
};
const ENGLISH_LABELS: Readonly<Record<RelocationEnglish, string>> = {
  none: 'Не знаю английский',
  A2: 'A2 — базовый',
  B1: 'B1 — средний',
  B2: 'B2 — рабочий',
  C1: 'C1 и выше',
};
export const FAMILY_LABELS: Readonly<Record<RelocationFamily, string>> = {
  alone: 'Один',
  partner: 'С партнёром',
  partner_kids: 'С партнёром и детьми',
  unknown: 'Пока не знаю',
};
const EXPERIENCE = [
  [1, 'До 2 лет'],
  [3, '2–4 года'],
  [5, '5–9 лет'],
  [10, '10 лет и больше'],
] as const;

export const RELOCATION_STEPS = 6;

export function citizenshipLabel(code: string): string {
  return CITIZENSHIP_LABELS[code as keyof typeof CITIZENSHIP_LABELS] ?? code;
}

export function countryName(code: string): string {
  return getCountryMobilityData(code).name;
}

interface ChoiceProps {
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}

function Choice({ pressed, onClick, children }: ChoiceProps) {
  return (
    <button type="button" className="rl-choice" aria-pressed={pressed} onClick={onClick}>
      <span className="rl-mk" aria-hidden="true" />
      {children}
    </button>
  );
}

interface StepProps {
  readonly draft: RelocationDraft;
  readonly update: (patch: Partial<RelocationDraft>) => void;
}

function Choices<T extends string | number>({
  labelledBy,
  options,
  value,
  onPick,
}: {
  readonly labelledBy: string;
  readonly options: readonly (readonly [T, string])[];
  readonly value: T | undefined;
  readonly onPick: (value: T) => void;
}) {
  return (
    <div className="rl-choices" role="group" aria-labelledby={labelledBy}>
      {options.map(([key, label]) => (
        <Choice key={String(key)} pressed={value === key} onClick={() => onPick(key)}>
          {label}
        </Choice>
      ))}
    </div>
  );
}

function ExperienceStep({ draft, update }: StepProps) {
  return (
    <>
      <Choices
        labelledBy="rl-q"
        options={RELOCATION_PROFESSIONS.map((id) => [id, PROFESSION_LABELS[id]] as const)}
        value={draft.profession}
        onPick={(profession) => update({ profession })}
      />
      <span className="rl-sub" id="rl-q-exp">
        Опыт в профессии
      </span>
      <Choices
        labelledBy="rl-q-exp"
        options={EXPERIENCE}
        value={draft.experienceYears}
        onPick={(experienceYears) => update({ experienceYears })}
      />
      <span className="rl-sub" id="rl-q-deg">
        Высшее образование
      </span>
      <Choices
        labelledBy="rl-q-deg"
        options={[
          ['yes', 'Есть диплом'],
          ['no', 'Нет диплома'],
        ]}
        value={draft.hasDegree === undefined ? undefined : draft.hasDegree ? 'yes' : 'no'}
        onPick={(value) => update({ hasDegree: value === 'yes' })}
      />
    </>
  );
}

function MoneyStep({ draft, update }: StepProps) {
  return (
    <div className="rl-money-in">
      <label className="rl-field">
        <span>Сумма на руки в месяц</span>
        <input
          inputMode="numeric"
          autoComplete="off"
          value={draft.netMonthly ? String(draft.netMonthly) : ''}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/gu, '').slice(0, 9);
            update({ netMonthly: digits ? Number(digits) : undefined });
          }}
        />
      </label>
      <label className="rl-field">
        <span>Валюта</span>
        <select
          value={draft.netCurrency ?? 'EUR'}
          onChange={(event) => update({ netCurrency: event.target.value })}
        >
          {RELOCATION_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function CountriesStep({ draft, update }: StepProps) {
  const full = draft.countries.length >= RELOCATION_MAX_COUNTRIES;
  const toggle = (code: string) => {
    if (draft.countries.includes(code)) {
      update({ countries: draft.countries.filter((item) => item !== code) });
    } else if (!full) {
      update({ countries: [...draft.countries, code] });
    }
  };
  return (
    <>
      <div className="rl-choices is-countries" role="group" aria-labelledby="rl-q">
        {COUNTRY_CODES.map((code) => (
          <Choice key={code} pressed={draft.countries.includes(code)} onClick={() => toggle(code)}>
            {countryName(code)}
          </Choice>
        ))}
      </div>
      <span className="rl-hint">До {RELOCATION_MAX_COUNTRIES} стран — по карточке на каждую.</span>
    </>
  );
}

const STEP_QUESTIONS = [
  'Какое у вас гражданство?',
  'Кем вы работаете?',
  'Какой у вас английский?',
  'Вы переезжаете один или с семьёй?',
  'Сколько вы хотите получать на руки?',
  'Какие страны рассматриваете?',
] as const;

function stepDone(step: number, draft: RelocationDraft): boolean {
  switch (step) {
    case 0:
      return Boolean(draft.citizenship);
    case 1:
      return (
        Boolean(draft.profession) &&
        draft.experienceYears !== undefined &&
        draft.hasDegree !== undefined
      );
    case 2:
      return Boolean(draft.english);
    case 3:
      return Boolean(draft.family);
    case 4:
      return Boolean(draft.netMonthly && draft.netMonthly > 0);
    default:
      return draft.countries.length > 0;
  }
}

function StepBody({ step, draft, update }: StepProps & { readonly step: number }) {
  switch (step) {
    case 0:
      return (
        <Choices
          labelledBy="rl-q"
          options={RELOCATION_CITIZENSHIPS.map((code) => [code, CITIZENSHIP_LABELS[code]] as const)}
          value={draft.citizenship as (typeof RELOCATION_CITIZENSHIPS)[number] | undefined}
          onPick={(citizenship) => update({ citizenship })}
        />
      );
    case 1:
      return <ExperienceStep draft={draft} update={update} />;
    case 2:
      return (
        <Choices
          labelledBy="rl-q"
          options={RELOCATION_ENGLISH.map((id) => [id, ENGLISH_LABELS[id]] as const)}
          value={draft.english}
          onPick={(english) => update({ english })}
        />
      );
    case 3:
      return (
        <Choices
          labelledBy="rl-q"
          options={RELOCATION_FAMILY.map((id) => [id, FAMILY_LABELS[id]] as const)}
          value={draft.family}
          onPick={(family) => update({ family })}
        />
      );
    case 4:
      return <MoneyStep draft={draft} update={update} />;
    default:
      return <CountriesStep draft={draft} update={update} />;
  }
}

function AnswerChips({ draft }: { readonly draft: RelocationDraft }) {
  const chips = [
    draft.citizenship && `Гражданство: ${citizenshipLabel(draft.citizenship)}`,
    draft.profession && `Профессия: ${PROFESSION_LABELS[draft.profession]}`,
    draft.english && `Английский: ${draft.english === 'none' ? 'нет' : draft.english}`,
    draft.family && FAMILY_LABELS[draft.family],
  ].filter((chip): chip is string => Boolean(chip));
  if (chips.length === 0) return null;
  return (
    <div className="rl-answers" aria-label="Ваши ответы">
      {chips.map((chip) => (
        <span className="ps-chip" key={chip}>
          {chip}
        </span>
      ))}
    </div>
  );
}

function completeAnswers(draft: RelocationDraft): RelocationAnswers | undefined {
  const { citizenship, profession, experienceYears, hasDegree, english, family, netMonthly } =
    draft;
  if (!citizenship || !profession || experienceYears === undefined || hasDegree === undefined)
    return undefined;
  if (!english || !family || !netMonthly || draft.countries.length === 0) return undefined;
  return {
    citizenship,
    profession,
    experienceYears,
    hasDegree,
    english,
    family,
    netMonthly,
    netCurrency: draft.netCurrency ?? 'EUR',
    countries: draft.countries,
  };
}

function WizardProgress({ step }: { readonly step: number }) {
  return (
    <>
      <div className="rl-wh">
        <span>
          Вопрос {step + 1} из {RELOCATION_STEPS}
        </span>
        <span>около минуты</span>
      </div>
      <div className="rl-steps" aria-hidden="true">
        {Array.from({ length: RELOCATION_STEPS }, (_, index) => (
          <i key={index} className={index <= step ? 'is-on' : undefined} />
        ))}
      </div>
    </>
  );
}

interface RelocationWizardProps {
  readonly initial?: RelocationAnswers;
  readonly onComplete: (answers: RelocationAnswers) => void;
}

export function RelocationWizard({ initial, onComplete }: RelocationWizardProps) {
  const [draft, setDraft] = useState<RelocationDraft>(
    initial ?? { countries: [], netCurrency: 'EUR' },
  );
  const [step, setStep] = useState(initial ? RELOCATION_STEPS - 1 : 0);
  const update = (patch: Partial<RelocationDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const last = step === RELOCATION_STEPS - 1;
  const ready = stepDone(step, draft);
  const next = () => {
    if (!ready) return;
    if (!last) {
      setStep(step + 1);
      return;
    }
    const answers = completeAnswers(draft);
    if (answers) onComplete(answers);
  };
  return (
    <div className="rl-wiz" aria-labelledby="rl-q">
      <WizardProgress step={step} />
      <div className="rl-wb">
        <AnswerChips draft={draft} />
        <span className="rl-qn" id="rl-q">
          {STEP_QUESTIONS[step]}
        </span>
        <StepBody step={step} draft={draft} update={update} />
      </div>
      <div className="rl-wf">
        <button
          className="ps-btn is-ghost"
          type="button"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          Назад
        </button>
        <button className="ps-btn is-primary" type="button" disabled={!ready} onClick={next}>
          {last ? 'Показать пути' : 'Дальше'}
        </button>
      </div>
    </div>
  );
}
