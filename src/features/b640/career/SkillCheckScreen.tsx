import type { RoleSkillAssessmentRun } from '../../../../server/domain/roleSkillAssessment';
import { Icon, Link, ResultLine } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import { BlockError, BlockSkeleton } from '../today/parts';
import { pageAttrs } from './careerPaths';
import {
  CASE_CRITERIA_LABELS,
  caseEyebrow,
  dialogueEyebrow,
  runSkillRows,
} from './skillCheckModel';
import { SkillQuestion } from './SkillQuestion';
import { SkillResult } from './SkillResult';
import { SkillStart } from './SkillStart';
import { SkillSuggestions } from './SkillSuggestions';
import { hasNoSuggestions, useSkillCheck, type SkillCheck } from './useSkillCheck';
import { loadSkillRoles } from './careerApi';
import { useLoad } from '../today/useLoad';
import { RoleTitlesProvider, useRoleLabel } from './roleLabelContext';

function SkillList({ run }: { readonly run: RoleSkillAssessmentRun }) {
  const label = useRoleLabel();
  const rows = runSkillRows(run);
  return (
    <details className="more-n">
      <summary>
        <Icon name="down" />
        Навыки роли «{label(run.roleTitle)}» · {rows.length}
      </summary>
      <ul className="rows exp-rows">
        {rows.map((row) => (
          <li className="row" key={row.id}>
            <div>
              <div className="row-title">{row.name}</div>
              {row.sub ? <div className="row-sub">{row.sub}</div> : null}
            </div>
            {row.earned ? (
              <span className="earned" role="img" aria-label="Подтверждено кейсом">
                <Icon name="checkc" />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ProfileAdded({ check }: { readonly check: SkillCheck }) {
  const change = check.run?.profileChange;
  if (!change?.memoryIds.length || change.revertedAt || check.run?.status !== 'cases') return null;
  return (
    <ResultLine
      text={`Добавлено в профиль · ${change.memoryIds.length}`}
      onUndo={() => void check.actions.rollbackSuggestions()}
    />
  );
}

function Done({ run }: { readonly run: RoleSkillAssessmentRun }) {
  const label = useRoleLabel();
  return (
    <section className="lead" aria-labelledby="sk-title">
      <h2 className="lead-title is-long" id="sk-title">
        Проверка роли «{label(run.roleTitle)}» пройдена · подтверждено{' '}
        {run.readiness.confirmedCount} из {run.skills.length}
      </h2>
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('s09')}>
          К ролям
        </Link>
      </div>
    </section>
  );
}

const MODEL_ACTIONS = new Set(['evaluation', 'discussion', 'appeal']);

function QuestionStep({
  check,
  onLater,
}: {
  readonly check: SkillCheck;
  readonly onLater: () => void;
}) {
  const { run, state, actions, activeCase } = check;
  if (!run) return null;
  const modelFailed =
    run.status === 'model_error' && MODEL_ACTIONS.has(run.modelError?.action ?? '');
  const failed = Boolean(state.error) || modelFailed;
  const retry = () => void (modelFailed ? actions.retryModel() : check.answerCase());
  if (run.status === 'dialogue')
    return (
      <SkillQuestion
        eyebrow={dialogueEyebrow(run)}
        title={run.dialogueQuestions[run.currentDialogueIndex] ?? ''}
        answer={state.dialogueAnswer}
        busy={state.busy}
        failed={failed}
        onChange={(dialogueAnswer) => actions.patch({ dialogueAnswer })}
        onSubmit={() => void actions.submitDialogue(state.dialogueAnswer)}
        onRetry={() => void actions.submitDialogue(state.dialogueAnswer)}
        onLater={onLater}
      />
    );
  if (!activeCase) return <Done run={run} />;
  return (
    <SkillQuestion
      eyebrow={caseEyebrow(run, activeCase)}
      title={activeCase.assessmentCase.prompt}
      criteria={CASE_CRITERIA_LABELS}
      answer={state.caseAnswer}
      busy={state.busy}
      failed={failed}
      onChange={actions.changeCaseAnswer}
      onSubmit={() => void check.answerCase()}
      onRetry={retry}
      onLater={onLater}
    />
  );
}

function RunStep({ check, onLater }: { readonly check: SkillCheck; readonly onLater: () => void }) {
  const { run, state, actions, resultCase } = check;
  if (!run) return null;
  if (resultCase?.evaluation)
    return (
      <SkillResult
        record={{ ...resultCase, evaluation: resultCase.evaluation }}
        busy={state.busy}
        failed={Boolean(state.error)}
        onNext={() => void check.nextAfterResult(true)}
        onAgain={check.answerAgain}
        onAppeal={actions.appealCase}
      />
    );
  if (hasNoSuggestions(run))
    return state.error ? (
      <BlockError
        text="Не удалось перейти к кейсам."
        onRetry={() => void actions.saveSuggestions()}
      />
    ) : (
      <BlockSkeleton label="Загружаем кейс" rows={4} />
    );
  const suggestionsFailed =
    run.status === 'model_error' && run.modelError?.action === 'suggestions';
  if (run.status === 'suggestions' || suggestionsFailed)
    return (
      <SkillSuggestions
        run={run}
        state={state}
        onToggle={(id, accepted, statement) =>
          actions.patch({
            suggestionDrafts: { ...state.suggestionDrafts, [id]: { accepted, statement } },
          })
        }
        onSave={() => void actions.saveSuggestions()}
        onSkip={() => void actions.skipSuggestions()}
        onRetry={() => void actions.retryModel()}
      />
    );
  if (run.status === 'complete' && !check.state.caseEditing) return <Done run={run} />;
  return <QuestionStep check={check} onLater={onLater} />;
}

function Body({
  check,
  onLater,
  otherRoles,
}: {
  readonly check: SkillCheck;
  readonly onLater: () => void;
  readonly otherRoles: readonly string[];
}) {
  const { state, actions } = check;
  if (state.loading && !state.current) return <BlockSkeleton label="Загружаем проверку" rows={4} />;
  if (!state.current)
    return (
      <BlockError
        text="Не удалось загрузить проверку навыков."
        onRetry={() => void actions.loadCurrent()}
      />
    );
  const startable = !check.run || state.current.state === 'role_changed';
  if (startable)
    return (
      <SkillStart
        current={state.current}
        busy={state.busy}
        failed={Boolean(state.error)}
        otherRoles={otherRoles}
        onStart={() => void actions.start()}
        onRetry={() => void actions.loadCurrent()}
      />
    );
  return (
    <>
      <ProfileAdded check={check} />
      <RunStep check={check} onLater={onLater} />
    </>
  );
}

/** C04: вопросы о роли, кейсы и итог кейса (C4b) на месте. */
function CheckPage({
  node,
  role,
  searchTitles,
}: {
  readonly node: B640Node;
  readonly role: string | undefined;
  readonly searchTitles: readonly string[];
}) {
  const { navigate } = useShell();
  const check = useSkillCheck(role);
  const current = check.state.current;
  const shownRole = current && 'roleTitle' in current ? current.roleTitle : role;
  const otherRoles = searchTitles.filter(
    (title) => title.trim().toLocaleLowerCase('ru') !== shownRole?.trim().toLocaleLowerCase('ru'),
  );
  const later = async () => {
    if (check.state.caseDraftDirty) await check.actions.saveCaseDraft();
    navigate(buildNodePath('s09'));
  };
  return (
    <div className="page" {...pageAttrs(node, check.resultCase ? 'c04b' : undefined)}>
      <div className="col">
        <Body check={check} onLater={() => void later()} otherRoles={otherRoles} />
        {check.run && !check.resultCase && check.state.current?.state !== 'role_changed' ? (
          <SkillList run={check.run} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * C04 «Проверка навыков». Без роли в адресе берётся первая роль поиска, проверку которой
 * можно начать: иначе вкладка открывала роль без требований и вела в тупик (B645).
 */
export function SkillCheckScreen({ node }: { readonly node: B640Node }) {
  const { search } = useShell();
  const param = new URLSearchParams(search).get('role') ?? undefined;
  const roles = useLoad(loadSkillRoles);
  if (roles.state === 'loading')
    return (
      <div className="page" {...pageAttrs(node)}>
        <div className="col">
          <BlockSkeleton label="Загружаем проверку" rows={4} />
        </div>
      </div>
    );
  const titles = roles.state === 'ready' ? roles.data.checkable : [];
  const role = param ?? (roles.state === 'ready' ? (roles.data.ready ?? titles[0]) : undefined);
  return (
    <RoleTitlesProvider titlesRu={roles.state === 'ready' ? roles.data.titlesRu : undefined}>
      <CheckPage key={role ?? ''} node={node} role={role} searchTitles={titles} />
    </RoleTitlesProvider>
  );
}
