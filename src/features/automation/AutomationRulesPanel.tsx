import { useEffect, useState, type FormEvent } from 'react';
import type {
  CandidateAutomationPlatform,
  CandidateAutomationRules,
} from '../../../server/domain/candidateAutomation';
import type { CandidateAutomationStopCompany } from '../../../server/candidate/sqliteCandidateAutomationRepository';
import { loadDecisionProfile } from '../../../shared/workPreferences';
import { AutomationStopCompanies } from './AutomationStopCompanies';
import { summarizeSearchGeography } from './searchConditionsSummary';
import './automation-rules.css';

export interface AutomationRulesPanelProps {
  readonly rules: CandidateAutomationRules;
  readonly stopCompanies: readonly CandidateAutomationStopCompany[];
  readonly busy: boolean;
  readonly message: string;
  readonly onSaveRules: (rules: CandidateAutomationRules) => Promise<void>;
  readonly onAddStopCompany: (company: string) => Promise<void>;
  readonly onRemoveStopCompany: (company: string) => Promise<void>;
}

type RuleRow = 'roles' | 'match' | 'platforms';

const PLATFORM_LABEL: Record<CandidateAutomationPlatform, string> = {
  hh: 'hh.ru',
  linkedin: 'LinkedIn',
};

function parseRoles(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/u)
        .map((role) => role.trim())
        .filter(Boolean),
    ),
  ];
}

function togglePlatform(
  current: ReadonlySet<CandidateAutomationPlatform>,
  platform: CandidateAutomationPlatform,
): Set<CandidateAutomationPlatform> {
  const next = new Set(current);
  if (!next.has(platform)) next.add(platform);
  else if (next.size > 1) next.delete(platform);
  return next;
}

function useRulesDraft(props: AutomationRulesPanelProps) {
  const [roles, setRoles] = useState(props.rules.roles.join('\n'));
  const [minimumMatch, setMinimumMatch] = useState(props.rules.minimumMatchPercent);
  const [platforms, setPlatforms] = useState<ReadonlySet<CandidateAutomationPlatform>>(
    () => new Set(props.rules.platforms),
  );
  useEffect(() => {
    setRoles(props.rules.roles.join('\n'));
    setMinimumMatch(props.rules.minimumMatchPercent);
    setPlatforms(new Set(props.rules.platforms));
  }, [props.rules]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void props.onSaveRules({
      roles: parseRoles(roles),
      minimumMatchPercent: minimumMatch,
      platforms: [...platforms],
      excludeStopCompanies: props.rules.excludeStopCompanies,
    });
  }
  return { roles, setRoles, minimumMatch, setMinimumMatch, platforms, setPlatforms, submit };
}

export function AutomationRulesPanel(props: AutomationRulesPanelProps) {
  const draft = useRulesDraft(props);
  return (
    <section
      className="automation-panel automation-rules-card"
      data-page="rules"
      aria-labelledby="automation-rules-title"
    >
      <form id="automation-rules-form" onSubmit={draft.submit} />
      <header className="automation-rules-card__head">
        <h2 id="automation-rules-title">Правила отбора</h2>
        <button
          className="career-btn"
          type="submit"
          form="automation-rules-form"
          disabled={props.busy}
        >
          {props.busy ? 'Сохраняем…' : 'Сохранить правила'}
        </button>
      </header>
      <p className="automation-rules-card__hint">Что попадает в очередь на одобрение.</p>
      <RulesRows panel={props} draft={draft} />
      {props.message ? (
        <p className="automation-status" role="status">
          {props.message}
        </p>
      ) : null}
    </section>
  );
}

function RulesRows({
  panel,
  draft,
}: {
  readonly panel: AutomationRulesPanelProps;
  readonly draft: ReturnType<typeof useRulesDraft>;
}) {
  const [open, setOpen] = useState<RuleRow | null>(null);
  const toggle = (row: RuleRow) => () => setOpen((current) => (current === row ? null : row));
  return (
    <dl className="automation-rules-card__rows">
      <RolesRow
        roles={draft.roles}
        open={open === 'roles'}
        onToggle={toggle('roles')}
        onChange={draft.setRoles}
      />
      <GeographyRow />
      <MatchRow
        value={draft.minimumMatch}
        open={open === 'match'}
        onToggle={toggle('match')}
        onChange={draft.setMinimumMatch}
      />
      <PlatformsRow
        platforms={draft.platforms}
        open={open === 'platforms'}
        onToggle={toggle('platforms')}
        onChange={(platform) => draft.setPlatforms(togglePlatform(draft.platforms, platform))}
      />
      <AutomationStopCompanies
        companies={panel.stopCompanies}
        busy={panel.busy}
        onAdd={panel.onAddStopCompany}
        onRemove={panel.onRemoveStopCompany}
      />
    </dl>
  );
}

function RowShell(props: {
  readonly title: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
  readonly action?: React.ReactNode;
}) {
  return (
    <div className="automation-rule-row">
      <dt>
        <strong>{props.title}</strong>
        {props.hint ? <small>{props.hint}</small> : null}
      </dt>
      <dd>{props.children}</dd>
      {props.action ? <div className="automation-rule-row__action">{props.action}</div> : null}
    </div>
  );
}

function EditButton({
  open,
  onToggle,
  label,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      className="career-btn career-btn-secondary career-btn-sm"
      aria-expanded={open}
      onClick={onToggle}
    >
      {open ? 'Свернуть' : label}
    </button>
  );
}

function RolesRow(props: {
  readonly roles: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onChange: (value: string) => void;
}) {
  const list = parseRoles(props.roles);
  return (
    <RowShell
      title="Роли"
      action={<EditButton open={props.open} onToggle={props.onToggle} label="Изменить" />}
    >
      <ul className="automation-rule-chips" aria-label="Целевые роли">
        {list.length ? (
          list.map((role) => <li key={role}>{role}</li>)
        ) : (
          <li className="is-empty">Роли не заданы</li>
        )}
      </ul>
      {props.open ? (
        <label className="automation-rule-editor" htmlFor="automation-target-roles">
          Целевые роли
          <textarea
            id="automation-target-roles"
            rows={3}
            value={props.roles}
            onChange={(event) => props.onChange(event.currentTarget.value)}
            placeholder="Одна роль в строке"
          />
        </label>
      ) : null}
    </RowShell>
  );
}

function GeographyRow() {
  const summary = summarizeSearchGeography(loadDecisionProfile());
  return (
    <RowShell title="География и формат" hint="Задаются в разделе «Карьера», условия поиска">
      <span className="automation-rule-value">{summary ?? 'Не заданы в условиях поиска'}</span>
    </RowShell>
  );
}

function MatchRow(props: {
  readonly value: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onChange: (value: number) => void;
}) {
  return (
    <RowShell
      title="Совпадение не ниже"
      hint="Считаем по вашим критериям, не по рынку"
      action={<EditButton open={props.open} onToggle={props.onToggle} label="Изменить" />}
    >
      <span className="automation-rule-value">{props.value} %</span>
      {props.open ? (
        <label className="automation-rule-editor" htmlFor="automation-minimum-match">
          Минимальное совпадение, %
          <input
            id="automation-minimum-match"
            type="number"
            min={0}
            max={100}
            step={5}
            value={props.value}
            onChange={(event) => props.onChange(Number(event.currentTarget.value))}
          />
        </label>
      ) : null}
    </RowShell>
  );
}

function PlatformsRow(props: {
  readonly platforms: ReadonlySet<CandidateAutomationPlatform>;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onChange: (platform: CandidateAutomationPlatform) => void;
}) {
  return (
    <RowShell
      title="Площадки"
      action={<EditButton open={props.open} onToggle={props.onToggle} label="Изменить" />}
    >
      {props.open ? (
        <fieldset className="automation-rule-editor automation-rule-platforms">
          <legend className="career-sr-only">Площадки</legend>
          {(['hh', 'linkedin'] as const).map((platform) => (
            <label key={platform} htmlFor={`automation-platform-${platform}`}>
              <input
                id={`automation-platform-${platform}`}
                type="checkbox"
                checked={props.platforms.has(platform)}
                onChange={() => props.onChange(platform)}
              />
              {PLATFORM_LABEL[platform]}
            </label>
          ))}
        </fieldset>
      ) : (
        <span className="automation-rule-value">
          {[...props.platforms].map((p) => PLATFORM_LABEL[p]).join(', ')}
        </span>
      )}
    </RowShell>
  );
}
