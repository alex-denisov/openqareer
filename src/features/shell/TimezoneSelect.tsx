import React from 'react';
import {
  COMMON_TIMEZONES,
  formatTimezoneOffset,
  getTimezoneCity,
} from '../../../shared/timezoneUtils';

export interface TimezoneSelectProps {
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  required?: boolean;
  deviceTimezone?: string;
  className?: string;
  selectClassName?: string;
}

interface OptionsListProps {
  selectedTz?: string;
  deviceTz: string;
}

function TimezoneOptionsList({ selectedTz, deviceTz }: OptionsListProps) {
  const deviceInCommon = COMMON_TIMEZONES.some((i) => i.timezone === deviceTz);
  const showCustom = Boolean(
    selectedTz &&
      !COMMON_TIMEZONES.some((i) => i.timezone === selectedTz) &&
      selectedTz !== deviceTz,
  );

  return (
    <>
      {showCustom && selectedTz ? (
        <option value={selectedTz}>
          {selectedTz} ({formatTimezoneOffset(selectedTz)})
        </option>
      ) : null}
      {!deviceInCommon ? (
        <option value={deviceTz}>
          Как на этом устройстве — {getTimezoneCity(deviceTz)} ({formatTimezoneOffset(deviceTz)})
        </option>
      ) : null}
      {COMMON_TIMEZONES.map((item) => {
        const isDevice = item.timezone === deviceTz;
        const offset = formatTimezoneOffset(item.timezone);
        const label = isDevice
          ? `${item.city} (${offset}) — как на этом устройстве`
          : `${item.city} (${offset})`;
        return (
          <option key={item.timezone} value={item.timezone}>
            {label}
          </option>
        );
      })}
    </>
  );
}

function resolveDeviceTz(explicitTz?: string): string {
  if (explicitTz) return explicitTz;
  if (typeof Intl !== 'undefined') {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return 'Europe/Moscow';
}

/**
 * Нативный селект выбора часового пояса с подписью «Часовой пояс» (B332).
 */
export function TimezoneSelect({
  name = 'timezone',
  id,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  deviceTimezone,
  className,
  selectClassName,
}: TimezoneSelectProps) {
  const deviceTz = resolveDeviceTz(deviceTimezone);
  const initialValue = defaultValue ?? (value === undefined ? deviceTz : undefined);

  return (
    <label className={`career-timezone-select-field ${className ?? ''}`.trim()}>
      <span>Часовой пояс</span>
      <select
        name={name}
        id={id}
        value={value}
        defaultValue={initialValue}
        onChange={onChange}
        disabled={disabled}
        required={required}
        className={selectClassName}
      >
        <TimezoneOptionsList selectedTz={value ?? defaultValue} deviceTz={deviceTz} />
      </select>
    </label>
  );
}
