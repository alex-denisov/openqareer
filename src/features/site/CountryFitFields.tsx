import React from 'react';
import type { CountryCode } from '../../../shared/taxData/types';
import { getCountryTaxData } from '../../../shared/taxData';
import { COUNTRY_CODES } from './countryFitScenario';
export function MoneyInput({
  label,
  value,
  onChange,
  id,
  invalid = false,
  errorId = 'cf-error',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id: string;
  invalid?: boolean;
  errorId?: string;
}) {
  return (
    <label className="cf-field" htmlFor={id}>
      {label}
      <input
        className="ym-disable-keys"
        id={id}
        inputMode="decimal"
        type="number"
        min="0"
        max="1000000000"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
      />
    </label>
  );
}

export function CountryChoice({
  value,
  onChange,
  name,
  label = 'Страна работы',
}: {
  value: CountryCode;
  onChange: (country: CountryCode) => void;
  name: string;
  label?: string;
}) {
  return (
    <fieldset className="cf-countries">
      <legend>{label}</legend>
      <div>
        {COUNTRY_CODES.map((code) => (
          <label key={code}>
            <input
              className="ym-disable-keys"
              type="radio"
              name={name}
              checked={value === code}
              onChange={() => onChange(code)}
            />
            <span>{getCountryTaxData(code).name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
