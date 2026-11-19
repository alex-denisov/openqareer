import { useState } from 'react';
import { getCountryMobilityData } from '../../../../shared/countryFit';
import type { RelocationQuestionnaireResponse } from '../../relocation/relocationApi';
import { Button, Dialog, StatusLine } from '../kit';
import { PAY_COUNTRIES } from './relocationApi';
import { vacanciesLabel } from './relocationModel';
import { choiceKey, putPlaces, type PlaceChoice, type RussianCity } from './relocationPlacesApi';
import { ConsentCheck, useConsentGate } from './RelocationWhoDialog';

const MAX_PLACES = 12;

interface Option {
  readonly choice: PlaceChoice;
  readonly label: string;
  readonly meta: string | null;
}

function options(cities: readonly RussianCity[]) {
  const countries: Option[] = PAY_COUNTRIES.map((code) => ({
    choice: { kind: 'country', code, skipped: [] },
    label: getCountryMobilityData(code).name,
    meta: null,
  }));
  const inside: Option[] = cities.map((city) => ({
    choice: { kind: 'city', slug: city.slug, skipped: [] },
    label: city.name,
    meta: vacanciesLabel(city.vacancies),
  }));
  return { countries, inside };
}

function OptionList(props: {
  readonly title: string;
  readonly items: readonly Option[];
  readonly picked: ReadonlySet<string>;
  readonly full: boolean;
  readonly onToggle: (key: string) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <fieldset className="field">
      <legend>{props.title}</legend>
      {props.items.map((item) => {
        const key = choiceKey(item.choice);
        const checked = props.picked.has(key);
        return (
          <div className="check" key={key}>
            <input
              id={`rl-place-${key}`}
              type="checkbox"
              checked={checked}
              disabled={!checked && props.full}
              onChange={() => props.onToggle(key)}
            />
            <label htmlFor={`rl-place-${key}`}>
              {item.label}
              {item.meta ? <span className="row-meta num"> · {item.meta}</span> : null}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

function useSave(
  questionnaire: RelocationQuestionnaireResponse | null,
  onSaved: () => void,
  onClose: () => void,
) {
  const consent = useConsentGate(questionnaire);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = async (places: readonly PlaceChoice[]) => {
    setBusy(true);
    setFailed(false);
    try {
      if (!questionnaire?.consent.granted) await consent.ensure();
      await putPlaces(places);
      onClose();
      onSaved();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return { consent, busy, failed, save };
}

/** Отмеченные места по порядку списка; у прежних мест сохраняется «Не про меня». */
function nextChoices(
  items: readonly Option[],
  picked: ReadonlySet<string>,
  choices: readonly PlaceChoice[],
): PlaceChoice[] {
  const previous = new Map(choices.map((choice) => [choiceKey(choice), choice]));
  return items
    .map((item) => item.choice)
    .filter((choice) => picked.has(choiceKey(choice)))
    .map((choice) => previous.get(choiceKey(choice)) ?? choice);
}

function usePicked(choices: readonly PlaceChoice[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(choices.map(choiceKey)));
  const toggle = (key: string) =>
    setPicked((current) => {
      const copy = new Set(current);
      if (copy.has(key)) copy.delete(key);
      else copy.add(key);
      return copy;
    });
  return [picked, toggle] as const;
}

function Footer(props: {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <>
      <Button variant="quiet" onClick={props.onCancel}>
        Отмена
      </Button>
      <Button variant="primary" busy={props.busy} disabled={props.disabled} onClick={props.onSave}>
        Сохранить
      </Button>
    </>
  );
}

/** «Изменить места»: страны с расчётом и города России с вакансиями. */
export function RelocationPlacesDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly choices: readonly PlaceChoice[];
  readonly cities: readonly RussianCity[];
  readonly questionnaire: RelocationQuestionnaireResponse | null;
  readonly onSaved: () => void;
}) {
  const [picked, toggle] = usePicked(props.choices);
  const saving = useSave(props.questionnaire, props.onSaved, props.onClose);
  const { countries, inside } = options(props.cities);
  const next = nextChoices([...countries, ...inside], picked, props.choices);
  const footer = (
    <Footer
      busy={saving.busy}
      disabled={next.length === 0 || !saving.consent.accepted}
      onSave={() => void saving.save(next)}
      onCancel={props.onClose}
    />
  );
  const full = picked.size >= MAX_PLACES;
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Куда смотреть" footer={footer}>
      <OptionList
        title="Другие страны"
        items={countries}
        picked={picked}
        full={full}
        onToggle={toggle}
      />
      <OptionList
        title="Города России"
        items={inside}
        picked={picked}
        full={full}
        onToggle={toggle}
      />
      <ConsentCheck
        questionnaire={props.questionnaire}
        accepted={saving.consent.accepted}
        onChange={saving.consent.setAccepted}
      />
      {saving.failed ? (
        <StatusLine state="err" text="Места не сохранились. Попробуйте ещё раз." />
      ) : null}
    </Dialog>
  );
}
