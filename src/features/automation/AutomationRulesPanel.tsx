import { Plus, X } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent } from 'react';
import type { CandidateAutomationRules, CandidateAutomationPlatform } from '../../../server/domain/candidateAutomation';
import type { CandidateAutomationStopCompany } from '../../../server/candidate/sqliteCandidateAutomationRepository';

export interface AutomationRulesPanelProps {
  readonly rules: CandidateAutomationRules;
  readonly stopCompanies: readonly CandidateAutomationStopCompany[];
  readonly busy: boolean;
  readonly message: string;
  readonly onSaveRules: (rules: CandidateAutomationRules) => Promise<void>;
  readonly onAddStopCompany: (company: string) => Promise<void>;
  readonly onRemoveStopCompany: (company: string) => Promise<void>;
}

export function AutomationRulesPanel(props: AutomationRulesPanelProps) {
  const [roles, setRoles] = useState(props.rules.roles.join('\n'));
  const [minimumMatch, setMinimumMatch] = useState(props.rules.minimumMatchPercent);
  const [platforms, setPlatforms] = useState<ReadonlySet<CandidateAutomationPlatform>>(() => new Set(props.rules.platforms));
  const [excludeStops, setExcludeStops] = useState(props.rules.excludeStopCompanies);
  useEffect(() => syncRules(props.rules, setRoles, setMinimumMatch, setPlatforms, setExcludeStops), [props.rules]);
  return <section className="automation-panel automation-rules-panel" data-page="rules" aria-labelledby="automation-rules-title">
    <header className="automation-panel-heading"><div><h2 id="automation-rules-title">Правила отбора</h2><p>Эти условия определяют, что попадёт в очередь.</p></div></header>
    <RulesForm roles={roles} minimumMatch={minimumMatch} platforms={platforms} excludeStops={excludeStops} busy={props.busy} onRoles={setRoles} onMinimumMatch={setMinimumMatch} onPlatforms={setPlatforms} onExcludeStops={setExcludeStops} onSave={props.onSaveRules} />
    <StopCompaniesPanel companies={props.stopCompanies} busy={props.busy} onAdd={props.onAddStopCompany} onRemove={props.onRemoveStopCompany} />
    {props.message ? <p className="automation-status" role="status">{props.message}</p> : null}
  </section>;
}

function RulesForm({ roles, minimumMatch, platforms, excludeStops, busy, onRoles, onMinimumMatch, onPlatforms, onExcludeStops, onSave }: {
  readonly roles: string;
  readonly minimumMatch: number;
  readonly platforms: ReadonlySet<CandidateAutomationPlatform>;
  readonly excludeStops: boolean;
  readonly busy: boolean;
  readonly onRoles: (value: string) => void;
  readonly onMinimumMatch: (value: number) => void;
  readonly onPlatforms: (value: ReadonlySet<CandidateAutomationPlatform>) => void;
  readonly onExcludeStops: (value: boolean) => void;
  readonly onSave: AutomationRulesPanelProps['onSaveRules'];
}) {
  function toggle(platform: CandidateAutomationPlatform) {
    onPlatforms(togglePlatform(platforms, platform));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = [...new Set(roles.split(/[\n,]/u).map((role) => role.trim()).filter(Boolean))];
    void onSave({ roles: normalized, minimumMatchPercent: minimumMatch, platforms: [...platforms], excludeStopCompanies: excludeStops });
  }
  return <form className="automation-rules-form" onSubmit={submit}>
    <label htmlFor="automation-target-roles">Целевые роли<textarea id="automation-target-roles" rows={3} value={roles} onChange={(event) => onRoles(event.currentTarget.value)} placeholder="Одна роль в строке" /></label>
    <label htmlFor="automation-minimum-match">Минимальное совпадение, %<input id="automation-minimum-match" type="number" min={0} max={100} step={5} value={minimumMatch} onChange={(event) => onMinimumMatch(Number(event.currentTarget.value))} /></label>
    <PlatformChecks platforms={platforms} onToggle={toggle} />
    <label className="automation-consent-row" htmlFor="automation-exclude-stops"><input id="automation-exclude-stops" type="checkbox" checked={excludeStops} onChange={(event) => onExcludeStops(event.currentTarget.checked)} />Исключать стоп-компании из отбора</label>
    <button className="career-btn career-btn-primary" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить правила'}</button>
  </form>;
}

function PlatformChecks({ platforms, onToggle }: { readonly platforms: ReadonlySet<CandidateAutomationPlatform>; readonly onToggle: (platform: CandidateAutomationPlatform) => void }) {
  return <fieldset className="automation-platform-checks"><legend>Площадки</legend>
    <label htmlFor="automation-platform-hh"><input id="automation-platform-hh" type="checkbox" checked={platforms.has('hh')} onChange={() => onToggle('hh')} />hh.ru</label>
    <label htmlFor="automation-platform-linkedin"><input id="automation-platform-linkedin" type="checkbox" checked={platforms.has('linkedin')} onChange={() => onToggle('linkedin')} />LinkedIn</label>
  </fieldset>;
}

function StopCompaniesPanel({ companies, busy, onAdd, onRemove }: {
  readonly companies: readonly CandidateAutomationStopCompany[];
  readonly busy: boolean;
  readonly onAdd: AutomationRulesPanelProps['onAddStopCompany'];
  readonly onRemove: AutomationRulesPanelProps['onRemoveStopCompany'];
}) {
  const [value, setValue] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const company = value.trim();
    if (!company) return;
    await onAdd(company);
    setValue('');
  }
  return <section className="automation-stops" aria-labelledby="automation-stops-title">
    <header><div><h3 id="automation-stops-title">Стоп-компании</h3><p>Добавленные названия исключаются из очереди.</p></div><span className="automation-count">{companies.length}</span></header>
    <form className="automation-add-stop" onSubmit={(event) => void submit(event)}><label htmlFor="automation-stop-company">Компания</label><input id="automation-stop-company" value={value} onChange={(event) => setValue(event.currentTarget.value)} maxLength={300} /><button className="career-btn career-btn-secondary" type="submit" disabled={busy || !value.trim()}><Plus size={18} aria-hidden="true" />Добавить</button></form>
    {companies.length ? <ul className="automation-stop-list">{companies.map((item) => <li key={item.company}><span>{item.company}<small>{item.origin === 'rejection' ? 'Добавлена из отказа' : 'Добавлена вами'}</small></span><button type="button" className="automation-icon-button" aria-label={`Убрать ${item.company} из стоп-компаний`} disabled={busy} onClick={() => void onRemove(item.company)}><X size={18} aria-hidden="true" /></button></li>)}</ul> : <p className="automation-empty">Стоп-компаний пока нет.</p>}
  </section>;
}

function syncRules(rules: CandidateAutomationRules, setRoles: (value: string) => void, setMinimumMatch: (value: number) => void, setPlatforms: (value: ReadonlySet<CandidateAutomationPlatform>) => void, setExcludeStops: (value: boolean) => void) {
  setRoles(rules.roles.join('\n'));
  setMinimumMatch(rules.minimumMatchPercent);
  setPlatforms(new Set(rules.platforms));
  setExcludeStops(rules.excludeStopCompanies);
}

function togglePlatform(current: ReadonlySet<CandidateAutomationPlatform>, platform: CandidateAutomationPlatform): Set<CandidateAutomationPlatform> {
  const next = new Set(current);
  if (next.has(platform)) {
    if (next.size > 1) next.delete(platform);
  } else next.add(platform);
  return next;
}
