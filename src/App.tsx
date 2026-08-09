import { useEffect, useState } from 'react';
import { prepareCareerWorkspace } from './features/journey/careerJourneyEngine';
import { createDemoWorkspace } from './features/journey/demoWorkspace';
import { CareerWorkspaceShell } from './features/shell/CareerWorkspaceShell';
import {
  clearWorkspace,
  loadWorkspace,
  saveWorkspace,
  type CandidateWorkspace,
  type WorkspaceInput,
} from './features/workspace/workspaceStorage';

interface AppState {
  workspace?: CandidateWorkspace;
  invalidStorage: boolean;
  demo: boolean;
}

function readInitialState(): AppState {
  const result = loadWorkspace(window.localStorage);
  if (result.status === 'ready') {
    return { workspace: result.workspace, invalidStorage: false, demo: false };
  }
  return { invalidStorage: result.status === 'invalid', demo: false };
}

export default function App() {
  const [state, setState] = useState(readInitialState);
  const [storageError, setStorageError] = useState<string>();

  useEffect(() => {
    document.getElementById('root')?.removeAttribute('aria-busy');
  }, []);

  function persist(workspace: CandidateWorkspace) {
    if (state.demo) {
      setState({ workspace, invalidStorage: false, demo: true });
      return;
    }
    try {
      saveWorkspace(window.localStorage, workspace);
      setStorageError(undefined);
    } catch {
      setStorageError(
        'Браузер не разрешил сохранить изменения. Проверьте настройки локального хранения.',
      );
    }
    setState({ workspace, invalidStorage: false, demo: false });
  }

  function handleSave(input: WorkspaceInput) {
    persist(prepareCareerWorkspace(input, undefined, state.workspace));
  }

  function handleClear() {
    try {
      clearWorkspace(window.localStorage);
      setStorageError(undefined);
      setState({ invalidStorage: false, demo: false });
    } catch {
      setStorageError(
        'Браузер не разрешил удалить запись. Очистите данные сайта в настройках.',
      );
    }
  }

  return (
    <CareerWorkspaceShell
      workspace={state.workspace}
      demo={state.demo}
      invalidStorage={state.invalidStorage}
      storageError={storageError}
      onSaveWorkspace={handleSave}
      onUpdateWorkspace={persist}
      onClearWorkspace={handleClear}
      onOpenDemo={() =>
        setState({
          workspace: createDemoWorkspace(),
          invalidStorage: false,
          demo: true,
        })
      }
      onExitDemo={() => setState({ invalidStorage: false, demo: false })}
    />
  );
}
