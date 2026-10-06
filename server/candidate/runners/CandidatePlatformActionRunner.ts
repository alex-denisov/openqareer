import type {
  CandidateActionItem,
  CandidateActionSession,
  PlatformActionRunner,
  RunnerOutcome,
} from '../candidateActionExecutor';
import { HhActionRunner } from './HhActionRunner';
import { LinkedinEasyApplyRunner } from './LinkedinEasyApplyRunner';

export class CandidatePlatformActionRunner implements PlatformActionRunner {
  constructor(
    private readonly hh = new HhActionRunner(),
    private readonly linkedin = new LinkedinEasyApplyRunner(),
  ) {}

  run(item: CandidateActionItem, session: CandidateActionSession): Promise<RunnerOutcome> {
    return item.platform === 'hh'
      ? this.hh.run(item, session)
      : this.linkedin.run(item, session);
  }
}
