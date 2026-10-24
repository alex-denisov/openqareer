import type { WorkspaceInput } from '../workspace/workspaceStorage';

export interface IntakeCompletionParts {
  /**
   * Persists the finished wizard. Returns a promise when the save also has to
   * reach the server, so completion can wait for the real outcome.
   */
  readonly save: (input: WorkspaceInput) => void | Promise<void>;
  readonly closeIntake: () => void;
  /** A failed explicit server completion keeps the wizard open for retry. */
  readonly closeAfterSave?: boolean;
  readonly refreshCabinet: () => void;
  /**
   * Marks the window in which the server does not yet hold what the import is
   * about to give it. «Сегодня» used to print a confident `0` for those ~12
   * seconds (B160 §3).
   */
  readonly setImporting?: (importing: boolean) => void;
}

/**
 * Closes the wizard immediately and re-reads the cabinet once the import has
 * actually settled.
 *
 * The cabinet reads the server exactly once, when it mounts. Completing the
 * wizard is what mounts it — while the resume import started in the same click
 * is still waiting on the structuring provider. So the cabinet's only reading
 * landed before the facts existed, and the candidate was told «Фактов пока
 * нет» over a profile the server was about to hold in full. The interface was
 * consistently one import behind: a second run showed the first run's facts
 * (INC-024, B160).
 *
 * The refresh happens on failure too. A failed import may still have committed
 * part of its work, and in every case the honest thing to show is what the
 * server actually holds now.
 */
export function createIntakeCompletion({
  save,
  closeIntake,
  closeAfterSave = false,
  refreshCabinet,
  setImporting = () => undefined,
}: IntakeCompletionParts): (input: WorkspaceInput) => void {
  return (input) => {
    if (!closeAfterSave) closeIntake();
    const saved = save(input);
    if (!isPromise(saved)) {
      if (closeAfterSave) closeIntake();
      return;
    }
    setImporting(true);
    const settled = () => {
      setImporting(false);
      refreshCabinet();
    };
    void saved.then(() => {
      if (closeAfterSave) closeIntake();
      settled();
    }, () => {
      setImporting(false);
      if (!closeAfterSave) refreshCabinet();
    });
  };
}

function isPromise(value: void | Promise<void>): value is Promise<void> {
  return typeof (value as Promise<void> | undefined)?.then === 'function';
}
