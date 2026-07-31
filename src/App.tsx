import { useState } from 'react';
import { CoachPortal } from './features/coach/CoachPortal';
import { ActionPackageWorkbench } from './features/action/ActionPackageWorkbench';
import {
  createActionPackage,
  type ActionPackage,
} from './features/action/actionPackageEngine';
import { EvidenceReview } from './features/evidence/EvidenceReview';
import {
  createCandidateAnalysis,
  type CandidateAnalysis,
} from './features/evidence/evidenceEngine';
import { OpportunityWorkbench } from './features/opportunity/OpportunityWorkbench';
import type { OpportunityRecord } from './features/opportunity/opportunityEngine';
import { OutcomeWorkbench } from './features/outcome/OutcomeWorkbench';
import type { OutcomeEvent } from './features/outcome/outcomeEngine';
import { WorkspaceHome } from './features/workspace/WorkspaceHome';
import { WorkspaceSetup } from './features/workspace/WorkspaceSetup';
import {
  clearWorkspace,
  createWorkspace,
  loadWorkspace,
  saveWorkspace,
  type CandidateWorkspace,
  type WorkspaceInput,
} from './features/workspace/workspaceStorage';

type AppMode =
  | 'setup'
  | 'home'
  | 'edit'
  | 'evidence'
  | 'opportunity'
  | 'action'
  | 'outcome'
  | 'coach';

function readInitialState(): {
  mode: AppMode;
  workspace?: CandidateWorkspace;
  invalidStorage: boolean;
} {
  const result = loadWorkspace(window.localStorage);

  if (result.status === 'ready') {
    return {
      mode: 'home',
      workspace: result.workspace,
      invalidStorage: false,
    };
  }

  return {
    mode: 'setup',
    invalidStorage: result.status === 'invalid',
  };
}

export default function App() {
  const [state, setState] = useState(readInitialState);
  const [storageError, setStorageError] = useState<string>();

  function handleSave(input: WorkspaceInput) {
    const workspace = createWorkspace(input, undefined, state.workspace);

    try {
      saveWorkspace(window.localStorage, workspace);
      setStorageError(undefined);
      setState({ mode: 'home', workspace, invalidStorage: false });
    } catch {
      setStorageError(
        'Проверьте, разрешено ли локальное хранение данных для этой страницы.',
      );
    }
  }

  function handleClear() {
    try {
      clearWorkspace(window.localStorage);
      setStorageError(undefined);
      setState({ mode: 'setup', invalidStorage: false });
    } catch {
      setStorageError(
        'Браузер не разрешил удалить запись. Очистите данные сайта в настройках.',
      );
    }
  }

  function handleOpenEvidence() {
    if (!state.workspace) {
      return;
    }

    const workspace = {
      ...state.workspace,
      analysis:
        state.workspace.analysis ??
        createCandidateAnalysis(state.workspace.resumeText),
      updatedAt: new Date().toISOString(),
    };

    try {
      saveWorkspace(window.localStorage, workspace);
      setStorageError(undefined);
      setState({ mode: 'evidence', workspace, invalidStorage: false });
    } catch {
      setStorageError(
        'Проверьте, разрешено ли локальное хранение данных для этой страницы.',
      );
      setState({ mode: 'evidence', workspace, invalidStorage: false });
    }
  }

  function handleAnalysisChange(analysis: CandidateAnalysis) {
    if (!state.workspace) {
      return;
    }

    const workspace: CandidateWorkspace = {
      ...state.workspace,
      analysis,
      updatedAt: new Date().toISOString(),
    };

    try {
      saveWorkspace(window.localStorage, workspace);
      setStorageError(undefined);
    } catch {
      setStorageError(
        'Проверьте, разрешено ли локальное хранение данных для этой страницы.',
      );
    }

    setState({ mode: 'evidence', workspace, invalidStorage: false });
  }

  function handleOpportunityChange(opportunity: OpportunityRecord) {
    if (!state.workspace) {
      return;
    }

    const workspace: CandidateWorkspace = {
      ...state.workspace,
      opportunity,
      actionPackage: undefined,
      outcomes: [],
      updatedAt: new Date().toISOString(),
    };

    try {
      saveWorkspace(window.localStorage, workspace);
      setStorageError(undefined);
    } catch {
      setStorageError(
        'Проверьте, разрешено ли локальное хранение данных для этой страницы.',
      );
    }

    setState({ mode: 'opportunity', workspace, invalidStorage: false });
  }

  function handleOpenActionPackage() {
    if (
      !state.workspace?.opportunity ||
      !state.workspace.analysis
    ) {
      return;
    }

    let actionPackage = state.workspace.actionPackage;
    if (
      !actionPackage ||
      actionPackage.opportunityId !== state.workspace.opportunity.id ||
      actionPackage.decisionChoice !==
        state.workspace.opportunity.decision?.choice
    ) {
      try {
        actionPackage = createActionPackage(
          state.workspace.opportunity,
          state.workspace.analysis.evidenceItems,
          state.workspace.targetDirection,
        );
      } catch {
        return;
      }
    }

    const workspace: CandidateWorkspace = {
      ...state.workspace,
      actionPackage,
      updatedAt: new Date().toISOString(),
    };

    try {
      saveWorkspace(window.localStorage, workspace);
      setStorageError(undefined);
    } catch {
      setStorageError(
        'Проверьте, разрешено ли локальное хранение данных для этой страницы.',
      );
    }

    setState({ mode: 'action', workspace, invalidStorage: false });
  }

  function handleActionPackageChange(actionPackage: ActionPackage) {
    if (!state.workspace) {
      return;
    }

    const workspace: CandidateWorkspace = {
      ...state.workspace,
      actionPackage,
      updatedAt: new Date().toISOString(),
    };

    try {
      saveWorkspace(window.localStorage, workspace);
      setStorageError(undefined);
    } catch {
      setStorageError(
        'Проверьте, разрешено ли локальное хранение данных для этой страницы.',
      );
    }

    setState({ mode: 'action', workspace, invalidStorage: false });
  }

  function handleOutcomeChange(outcomes: OutcomeEvent[]) {
    if (!state.workspace) {
      return;
    }

    const workspace: CandidateWorkspace = {
      ...state.workspace,
      outcomes,
      updatedAt: new Date().toISOString(),
    };

    try {
      saveWorkspace(window.localStorage, workspace);
      setStorageError(undefined);
    } catch {
      setStorageError(
        'Проверьте, разрешено ли локальное хранение данных для этой страницы.',
      );
    }

    setState({ mode: 'outcome', workspace, invalidStorage: false });
  }

  return (
    <div className="app-root" data-testid="workspace-root">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />

      <div className="app-frame">
        {state.mode !== 'coach' ? (
          <div className="utility-bar">
            <p>Карьерный workspace</p>
            <div className="utility-actions">
              <span>Сохранённый маршрут · защищённая сессия</span>
              <button
                className="coach-entry"
                onClick={() =>
                  setState((current) => ({ ...current, mode: 'coach' }))
                }
              >
                <i aria-hidden="true" />
                ИИ-коуч
              </button>
            </div>
          </div>
        ) : null}

        {state.mode === 'coach' ? (
          <CoachPortal
            onBack={() =>
              setState((current) => ({
                ...current,
                mode: current.workspace ? 'home' : 'setup',
              }))
            }
          />
        ) : state.mode === 'outcome' &&
        state.workspace?.opportunity &&
        state.workspace.actionPackage ? (
          <OutcomeWorkbench
            workspace={state.workspace}
            storageError={storageError}
            onBack={() =>
              setState((current) => ({ ...current, mode: 'action' }))
            }
            onChange={handleOutcomeChange}
          />
        ) : state.mode === 'action' &&
        state.workspace?.analysis &&
        state.workspace.opportunity &&
        state.workspace.actionPackage ? (
          <ActionPackageWorkbench
            workspace={state.workspace}
            actionPackage={state.workspace.actionPackage}
            storageError={storageError}
            onBack={() =>
              setState((current) => ({ ...current, mode: 'opportunity' }))
            }
            onChange={handleActionPackageChange}
            onOpenOutcome={() =>
              setState((current) => ({ ...current, mode: 'outcome' }))
            }
          />
        ) : state.mode === 'opportunity' && state.workspace?.analysis ? (
          <OpportunityWorkbench
            workspace={state.workspace}
            storageError={storageError}
            onBack={() =>
              setState((current) => ({ ...current, mode: 'home' }))
            }
            onChange={handleOpportunityChange}
            onOpenActionPackage={handleOpenActionPackage}
          />
        ) : state.mode === 'evidence' && state.workspace?.analysis ? (
          <EvidenceReview
            workspace={state.workspace}
            storageError={storageError}
            onBack={() =>
              setState((current) => ({ ...current, mode: 'home' }))
            }
            onChange={handleAnalysisChange}
            onOpenOpportunity={() =>
              setState((current) => ({ ...current, mode: 'opportunity' }))
            }
          />
        ) : state.mode === 'home' && state.workspace ? (
          <WorkspaceHome
            workspace={state.workspace}
            onOpenEvidence={handleOpenEvidence}
            onOpenOpportunity={() =>
              setState((current) => ({ ...current, mode: 'opportunity' }))
            }
            onOpenActionPackage={handleOpenActionPackage}
            onOpenOutcome={() =>
              setState((current) => ({ ...current, mode: 'outcome' }))
            }
            onEdit={() => setState((current) => ({ ...current, mode: 'edit' }))}
            onClear={handleClear}
          />
        ) : (
          <WorkspaceSetup
            initialInput={state.workspace}
            invalidStorage={state.invalidStorage}
            storageError={storageError}
            onCancel={
              state.workspace
                ? () =>
                    setState((current) => ({ ...current, mode: 'home' }))
                : undefined
            }
            onResetInvalid={handleClear}
            onSubmit={handleSave}
          />
        )}
      </div>
    </div>
  );
}
