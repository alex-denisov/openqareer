import { useState } from 'react';
import {
  completeCandidateAnalysis,
  createCandidateAnalysis,
} from './features/evidence/evidenceEngine';
import { CareerWorkspaceShell } from './features/shell/CareerWorkspaceShell';
import {
  clearWorkspace,
  createWorkspace,
  loadWorkspace,
  saveWorkspace,
  type CandidateWorkspace,
  type WorkspaceInput,
} from './features/workspace/workspaceStorage';

interface AppState {
  workspace?: CandidateWorkspace;
  invalidStorage: boolean;
}

function readInitialState(): AppState {
  const result = loadWorkspace(window.localStorage);
  if (result.status === 'ready') {
    return { workspace: result.workspace, invalidStorage: false };
  }
  return { invalidStorage: result.status === 'invalid' };
}

export default function App() {
  const [state, setState] = useState(readInitialState);
  const [storageError, setStorageError] = useState<string>();

  function persist(workspace: CandidateWorkspace) {
    try {
      saveWorkspace(window.localStorage, workspace);
      setStorageError(undefined);
    } catch {
      setStorageError(
        'Браузер не разрешил сохранить изменения. Проверьте настройки локального хранения.',
      );
    }
    setState({ workspace, invalidStorage: false });
  }

  function handleSave(input: WorkspaceInput) {
    const workspace = createWorkspace(input, undefined, state.workspace);
    const evidenceSource = workspace.resumeText || workspace.currentSituation;
    const extracted = createCandidateAnalysis(evidenceSource);
    const analysis = workspace.targetDirection.trim()
      ? completeCandidateAnalysis(workspace.targetDirection, extracted)
      : extracted;
    persist({ ...workspace, analysis });
  }

  function handleClear() {
    try {
      clearWorkspace(window.localStorage);
      setStorageError(undefined);
      setState({ invalidStorage: false });
    } catch {
      setStorageError(
        'Браузер не разрешил удалить запись. Очистите данные сайта в настройках.',
      );
    }
  }

  return (
    <CareerWorkspaceShell
      workspace={state.workspace}
      invalidStorage={state.invalidStorage}
      storageError={storageError}
      onSaveWorkspace={handleSave}
      onUpdateWorkspace={persist}
      onClearWorkspace={handleClear}
    />
  );
}
