import { useState } from 'react';
import { EvidenceReview } from './features/evidence/EvidenceReview';
import {
  createCandidateAnalysis,
  type CandidateAnalysis,
} from './features/evidence/evidenceEngine';
import { OpportunityWorkbench } from './features/opportunity/OpportunityWorkbench';
import type { OpportunityRecord } from './features/opportunity/opportunityEngine';
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

type AppMode = 'setup' | 'home' | 'edit' | 'evidence' | 'opportunity';

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

  return (
    <div className="app-root" data-testid="workspace-root">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />

      <div className="app-frame">
        <div className="utility-bar">
          <p>Карьерный workspace</p>
          <span>Локальный MVP · без внешних действий</span>
        </div>

        {state.mode === 'opportunity' && state.workspace?.analysis ? (
          <OpportunityWorkbench
            workspace={state.workspace}
            storageError={storageError}
            onBack={() =>
              setState((current) => ({ ...current, mode: 'home' }))
            }
            onChange={handleOpportunityChange}
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
