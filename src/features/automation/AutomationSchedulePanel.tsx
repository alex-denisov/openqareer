import { useEffect, useState } from 'react';
import type { CandidateAutomationRuntime } from '../../../server/candidate/sqliteCandidateAutomationRepository';
import type { CandidateAutomationSchedule } from '../../../server/candidate/candidateAutomationScheduler';

export interface AutomationSchedulePanelProps {
  readonly schedule: CandidateAutomationSchedule;
  readonly runtime: CandidateAutomationRuntime;
  readonly busy: boolean;
  readonly message: string;
  readonly onSave: (schedule: CandidateAutomationSchedule) => Promise<void>;
  readonly onOpenConnections: () => void;
}

export function AutomationSchedulePanel(props: AutomationSchedulePanelProps) {
  const [draft, setDraft] = useState(props.schedule);
  useEffect(() => setDraft(props.schedule), [props.schedule]);
  const update = (change: (current: CandidateAutomationSchedule) => CandidateAutomationSchedule) => setDraft(change);
  return <section className="automation-panel automation-schedule-panel" data-page="settings" aria-labelledby="automation-settings-title">
    <header className="automation-panel-heading"><div><h2 id="automation-settings-title">Настройка режима</h2><p>Площадки, дневные ограничения и окна отправки.</p></div><span className={`automation-status-chip is-${props.runtime.status}`}>{runtimeStatusLabel(props.runtime.status)}</span></header>
    <SchedulePlatforms schedule={draft} update={update} onOpenConnections={props.onOpenConnections} />
    <ScheduleSafetyFields schedule={draft} update={update} />
    <MaterialsNote />
    {props.message ? <p className="automation-status" role="status">{props.message}</p> : null}
    <button className="career-btn career-btn-primary" type="button" disabled={props.busy} onClick={() => void props.onSave(draft)}>{props.busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>
  </section>;
}

function SchedulePlatforms({ schedule, update, onOpenConnections }: {
  readonly schedule: CandidateAutomationSchedule;
  readonly update: (change: (current: CandidateAutomationSchedule) => CandidateAutomationSchedule) => void;
  readonly onOpenConnections: () => void;
}) {
  return <div className="automation-schedule-platforms">
    <PlatformFields platform="hh" label="hh.ru" limit={schedule.dailyLimits.hh} window={schedule.sendWindows.hh} timezone={schedule.timezone} update={update} />
    <PlatformFields platform="linkedin" label="LinkedIn" limit={schedule.dailyLimits.linkedin} window={schedule.sendWindows.linkedin} timezone={schedule.timezone} update={update} />
    <button className="automation-link-button" type="button" onClick={onOpenConnections}>Проверить подключение LinkedIn</button>
  </div>;
}

function PlatformFields({ platform, label, limit, window, timezone, update }: {
  readonly platform: 'hh' | 'linkedin';
  readonly label: string;
  readonly limit: number;
  readonly window: CandidateAutomationSchedule['sendWindows']['hh'];
  readonly timezone: string;
  readonly update: (change: (current: CandidateAutomationSchedule) => CandidateAutomationSchedule) => void;
}) {
  const maximum = platform === 'hh' ? 15 : 10;
  function updateLimit(value: number) {
    update((current) => ({ ...current, dailyLimits: { ...current.dailyLimits, [platform]: value } }));
  }
  function updateTime(field: 'start' | 'end', value: string) {
    update((current) => ({ ...current, sendWindows: { ...current.sendWindows, [platform]: { ...current.sendWindows[platform], [field]: value } } }));
  }
  return <fieldset>
    <legend>{label}</legend>
    <label>Лимит в день<input type="number" min={1} max={maximum} value={limit} onChange={(event) => updateLimit(Number(event.currentTarget.value))} /></label>
    <label>Начало окна<input type="time" value={window.start} onChange={(event) => updateTime('start', event.currentTarget.value)} /></label>
    <label>Конец окна<input type="time" value={window.end} onChange={(event) => updateTime('end', event.currentTarget.value)} /></label>
    <p>{platform === 'hh' ? 'Пн–Пт' : 'Пн–Чт'} · время {timezone}</p>
  </fieldset>;
}

function ScheduleSafetyFields({ schedule, update }: {
  readonly schedule: CandidateAutomationSchedule;
  readonly update: (change: (current: CandidateAutomationSchedule) => CandidateAutomationSchedule) => void;
}) {
  return <fieldset className="automation-schedule-behavior"><legend>Паузы и безопасность</legend>
    <div className="automation-settings-grid">
      <NumberField label="Минимальная пауза, минут" min={2} max={9} value={schedule.minPauseMinutes} onChange={(value) => update((current) => ({ ...current, minPauseMinutes: value }))} />
      <NumberField label="Максимальная пауза, минут" min={2} max={9} value={schedule.maxPauseMinutes} onChange={(value) => update((current) => ({ ...current, maxPauseMinutes: value }))} />
      <NumberField label="Перерыв после откликов" min={1} max={20} value={schedule.breakAfterSent} onChange={(value) => update((current) => ({ ...current, breakAfterSent: value }))} />
      <NumberField label="Длительность перерыва, минут" min={30} max={240} value={schedule.breakMinutes} onChange={(value) => update((current) => ({ ...current, breakMinutes: value }))} />
    </div>
    <QuietWindowFields schedule={schedule} update={update} />
    <p>После первой ошибки отправка останавливается до проверки.</p>
  </fieldset>;
}

function NumberField({ label, min, max, value, onChange }: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  return <label>{label}<input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} /></label>;
}

function QuietWindowFields({ schedule, update }: {
  readonly schedule: CandidateAutomationSchedule;
  readonly update: (change: (current: CandidateAutomationSchedule) => CandidateAutomationSchedule) => void;
}) {
  return <div className="automation-quiet-windows"><strong>Окна тишины</strong>
    {schedule.quietWindows.map((window, index) => <div key={`${window.start}-${index}`}>
      <TimeField label="С" value={window.start} onChange={(value) => updateQuietWindow(update, index, 'start', value)} />
      <TimeField label="До" value={window.end} onChange={(value) => updateQuietWindow(update, index, 'end', value)} />
    </div>)}
  </div>;
}

function TimeField({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  return <label>{label}<input type="time" value={value} onChange={(event) => onChange(event.currentTarget.value)} /></label>;
}

function updateQuietWindow(update: (change: (current: CandidateAutomationSchedule) => CandidateAutomationSchedule) => void, index: number, field: 'start' | 'end', value: string) {
  update((current) => ({ ...current, quietWindows: current.quietWindows.map((window, windowIndex) => windowIndex === index ? { ...window, [field]: value } : window) }));
}

function MaterialsNote() {
  return <section className="automation-materials-note" aria-labelledby="automation-materials-title"><h3 id="automation-materials-title">Материалы отклика</h3><p>Состав материалов берётся из документов, привязанных к вакансии. Отдельных настроек тона и длины сейчас нет; письмо можно править в очереди до одобрения.</p></section>;
}

function runtimeStatusLabel(status: CandidateAutomationRuntime['status']): string {
  if (status === 'paused') return 'Пауза';
  if (status === 'daily_limit_reached') return 'Лимит дня';
  if (status === 'error') return 'Ошибка отправки';
  if (status === 'linkedin_not_connected') return 'LinkedIn не подключён';
  if (status === 'prepared') return 'Подготовлено';
  if (status === 'waiting') return 'Ожидает окна';
  return 'По расписанию';
}
