import type { CandidateCredentials, CandidateStore } from '../../server/data/candidateStore';
import type { CandidateWorkspaceState } from '../../server/domain/candidateWorkspace';

export type BlockADemoProfile = 'normal' | 'empty';
export type BlockADemoResumeMode = 'normal' | 'hold' | 'unavailable';
export type BlockADemoResumeSaveMode = 'normal' | 'fail-once';

export interface BlockADemoCandidateContext {
  candidate: CandidateCredentials;
  store: CandidateStore;
}

export interface BlockADemoScenarioState {
  readonly profile: BlockADemoProfile;
  readonly resumeMode: BlockADemoResumeMode;
  readonly resumeSaveMode: BlockADemoResumeSaveMode;
  readonly pendingResumeGets: number;
  readonly normalCandidateId: string;
  readonly emptyCandidateId: string;
  readonly activeCandidateId: string;
}

/** Routes candidate-scoped calls to the real isolated store for each local synthetic candidate. */
export function createCandidateStoreRouter(
  defaultStore: CandidateStore,
  storesByCandidateId: ReadonlyMap<string, CandidateStore>,
): CandidateStore {
  const stores = [...new Set([defaultStore, ...storesByCandidateId.values()])];

  return new Proxy(defaultStore, {
    get(target, property) {
      if (property === 'authenticate') {
        return (accessToken: string) => {
          for (const store of stores) {
            const candidate = store.authenticate(accessToken);
            if (candidate) return candidate;
          }
          return null;
        };
      }

      const defaultValue = Reflect.get(target, property, target);
      if (typeof defaultValue !== 'function') return defaultValue;

      return (...args: unknown[]) => {
        const candidateId = args.find(
          (argument): argument is string =>
            typeof argument === 'string' && storesByCandidateId.has(argument),
        );
        const store = candidateId ? (storesByCandidateId.get(candidateId) ?? target) : target;
        const method = Reflect.get(store, property, store) as (...methodArgs: unknown[]) => unknown;
        return Reflect.apply(method, store, args);
      };
    },
  }) as CandidateStore;
}

/**
 * Controls only the loopback demo. Held resume reads resume through the real route
 * after release; unavailable reads return a local deterministic 503 before routing.
 */
export interface BlockADemoScenarioCommand {
  profile?: BlockADemoProfile;
  resumeMode?: BlockADemoResumeMode;
  resumeSaveMode?: BlockADemoResumeSaveMode;
}

export type BlockADemoScenarioParseResult =
  | { readonly ok: true; readonly command: BlockADemoScenarioCommand }
  | { readonly ok: false; readonly code: string; readonly message: string };

function isBlockADemoResumeSaveMode(value: unknown): value is BlockADemoResumeSaveMode {
  return value === 'normal' || value === 'fail-once';
}

function invalidResumeSaveMode(value: unknown): BlockADemoScenarioParseResult | undefined {
  if (value === undefined || isBlockADemoResumeSaveMode(value)) return undefined;
  return {
    ok: false,
    code: 'invalid_block_a_resume_save_mode',
    message: 'Режим сохранения резюме должен быть normal или fail-once.',
  };
}

export function parseBlockADemoScenarioCommand(raw: unknown): BlockADemoScenarioParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'invalid_block_a_scenario', message: 'Передайте объект сценария.' };
  }
  const command = raw as Record<string, unknown>;
  const unknownField = Object.keys(command).some(
    (key) => key !== 'profile' && key !== 'resumeMode' && key !== 'resumeSaveMode',
  );
  if (unknownField) {
    return {
      ok: false,
      code: 'invalid_block_a_scenario',
      message: 'Сценарий содержит неизвестное поле.',
    };
  }
  if (
    command.profile !== undefined &&
    command.profile !== 'normal' &&
    command.profile !== 'empty'
  ) {
    return {
      ok: false,
      code: 'invalid_block_a_profile',
      message: 'Профиль должен быть normal или empty.',
    };
  }
  if (
    command.resumeMode !== undefined &&
    command.resumeMode !== 'normal' &&
    command.resumeMode !== 'hold' &&
    command.resumeMode !== 'unavailable'
  ) {
    return {
      ok: false,
      code: 'invalid_block_a_resume_mode',
      message: 'Режим резюме должен быть normal, hold или unavailable.',
    };
  }
  const invalidSaveMode = invalidResumeSaveMode(command.resumeSaveMode);
  if (invalidSaveMode) return invalidSaveMode;
  return {
    ok: true,
    command: {
      ...(command.profile !== undefined ? { profile: command.profile } : {}),
      ...(command.resumeMode !== undefined ? { resumeMode: command.resumeMode } : {}),
      ...(command.resumeSaveMode !== undefined ? { resumeSaveMode: command.resumeSaveMode } : {}),
    },
  };
}

export class BlockADemoScenarioController {
  private profile: BlockADemoProfile = 'normal';
  private resumeMode: BlockADemoResumeMode = 'normal';
  private resumeSaveMode: BlockADemoResumeSaveMode = 'normal';
  private readonly heldResumeRequests = new Set<() => void>();

  constructor(private readonly profiles: Record<BlockADemoProfile, BlockADemoCandidateContext>) {}

  get activeCandidate(): BlockADemoCandidateContext {
    return this.profiles[this.profile];
  }

  get state(): BlockADemoScenarioState {
    return {
      profile: this.profile,
      resumeMode: this.resumeMode,
      resumeSaveMode: this.resumeSaveMode,
      pendingResumeGets: this.heldResumeRequests.size,
      normalCandidateId: this.profiles.normal.candidate.id,
      emptyCandidateId: this.profiles.empty.candidate.id,
      activeCandidateId: this.activeCandidate.candidate.id,
    };
  }

  selectProfile(profile: BlockADemoProfile): void {
    this.profile = profile;
  }

  setResumeMode(mode: BlockADemoResumeMode): void {
    this.resumeMode = mode;
    if (mode !== 'hold') this.releaseHeldResumeRequests();
  }

  setResumeSaveMode(mode: BlockADemoResumeSaveMode): void {
    this.resumeSaveMode = mode;
  }

  async beforeResumeGet(): Promise<'continue' | 'unavailable'> {
    if (this.resumeMode === 'hold') {
      await new Promise<void>((resolve) => this.heldResumeRequests.add(resolve));
    }
    return this.resumeMode === 'unavailable' ? 'unavailable' : 'continue';
  }

  beforeResumePut(): 'continue' | 'unavailable' {
    if (this.profile !== 'empty' || this.resumeSaveMode !== 'fail-once') return 'continue';
    this.resumeSaveMode = 'normal';
    return 'unavailable';
  }

  private releaseHeldResumeRequests(): void {
    for (const release of this.heldResumeRequests) release();
    this.heldResumeRequests.clear();
  }
}

export function createEmptyDemoWorkspace(): CandidateWorkspaceState {
  return {
    resumeText: '',
    resumeSource: 'text',
    targetDirection: '',
    regions: [],
    currentSituation: '',
    constraints: '',
    urgency: 'exploring',
  };
}
