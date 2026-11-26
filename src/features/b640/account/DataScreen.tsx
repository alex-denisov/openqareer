import { useState } from 'react';
import {
  getAccountCapabilityConsents,
  grantAccountCapabilityConsent,
  revokeAccountCapabilityConsent,
} from '../../account/accountCapabilityConsentApi';
import {
  getCandidateAutomation,
  pauseCandidateAutomation,
  resumeCandidateAutomation,
} from '../../automation/automationApi';
import { exportCandidateData } from '../../coach/coachApi';
import { getSearchConsent } from '../../vacancies/recruiterContactsApi';
import {
  CAPABILITY_CONSENT_CURRENT_VERSION,
  capabilityConsentDocument,
  type CandidateCapability,
} from '../../legal/capabilityConsents';
import { triggerFileDownload } from '../../resume/resumeExport';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import { Dialog } from '../kit/Dialog';
import { Icon } from '../kit/Icon';
import { ResultLine } from '../kit/ResultLine';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { AccountDeletionGroup } from './AccountDeletion';
import { getAccountDeletion, type AccountDeletion } from './accountDeletionApi';
import { countScheduledPosts } from '../platforms/linkedin/linkedinQueueApi';
import { ConsentDialog, ConsentItems, ConsentSwitch, ConsentTextLink, useAction } from './consentParts';
import { automationLine, CONSENT_ROWS, type AutomationState, type ConsentRow } from './dataModel';
import { SearchConsentRow } from './SearchConsentRow';
import { ErrorLine, SettingsPage, useLoad, type Load } from './parts';

/** Действующие согласия и принятая версия каждого. */
type GrantedVersions = Partial<Readonly<Record<CandidateCapability, string>>>;

interface AccountData {
  /** Согласия, которые сейчас действуют. */
  readonly granted: GrantedVersions;
  /** «Вы в поиске» (B263); `null` — не прочиталось: строка с ошибкой и «Повторить». */
  readonly searchConsent: boolean | null;
  /** Автоотклики; `null` — состояние не прочиталось. */
  readonly automation: AutomationState | null;
  /** Удаление аккаунта; `undefined` — состояние не прочиталось, группы нет. */
  readonly deletion: AccountDeletion | null | undefined;
}

/** Пауза «Остановить всё» ставится на предельный срок: снимает её сам кандидат. */
const STOP_DAYS = 365;

async function loadData(): Promise<AccountData> {
  const [consents, searchConsent, automation, deletion, scheduledPosts] = await Promise.all([
    getAccountCapabilityConsents(),
    getSearchConsent().then(
      (consent) => consent.granted,
      () => null,
    ),
    getCandidateAutomation().catch(() => null),
    getAccountDeletion().catch(() => undefined),
    countScheduledPosts().catch(() => 0),
  ]);
  return {
    granted: Object.fromEntries(
      consents.filter((item) => item.revokedAt === null).map((item) => [item.capability, item.versionId]),
    ),
    searchConsent,
    automation: automation
      ? {
          enabled: automation.settings.enabled,
          pausedUntil: automation.settings.pausedUntil,
          emergencyPaused: automation.schedulerRuntime?.emergencyPaused === true,
          scheduledPosts,
        }
      : null,
    deletion,
  };
}

function Group({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="set-group" aria-label={title}>
      <h3 className="set-h">{title}</h3>
      <ul className="set-list">{children}</ul>
    </section>
  );
}

interface RevokeDialogProps {
  readonly row: ConsentRow;
  readonly open: boolean;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onRevoke: () => void;
  readonly onClose: () => void;
}

/** Подтверждение отзыва согласия, с которым стираются данные. */
function RevokeDialog({ row, open, busy, failed, onRevoke, onClose }: RevokeDialogProps) {
  if (!row.revokeWarning) return null;
  return (
    <Dialog open={open} title={row.revokeWarning.title} onClose={onClose}>
      <p className="c5-lead">{row.revokeWarning.text}</p>
      {failed ? <ErrorLine text="Согласие не отозвано" /> : null}
      <div className="actions">
        <button className="btn is-danger" type="button" disabled={busy} aria-busy={busy || undefined} onClick={onRevoke}>
          Отозвать
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Dialog>
  );
}

interface ConsentProps {
  readonly row: ConsentRow;
  /** Принятая версия; нет — согласие не дано. */
  readonly grantedVersion: string | undefined;
  readonly onChanged: () => void;
}

/** Согласие: отзыв — переключателем, выдача — после текста согласия в окне. */
function Consent({ row, grantedVersion, onChanged }: ConsentProps) {
  const granted = grantedVersion !== undefined;
  const [asking, setAsking] = useState(false);
  const { busy, failed, run } = useAction(() => {
    setAsking(false);
    setRevoking(false);
    onChanged();
  });
  const grant = () =>
    run(() => grantAccountCapabilityConsent(row.capability, CAPABILITY_CONSENT_CURRENT_VERSION[row.capability]));
  const revoke = () => run(() => revokeAccountCapabilityConsent(row.capability));
  const [revoking, setRevoking] = useState(false);
  const toggle = (checked: boolean) => {
    if (checked) return setAsking(true);
    // Отзыв, который стирает данные, идёт только через подтверждение.
    return row.revokeWarning ? setRevoking(true) : revoke();
  };
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">{row.title}</span>
        <span className="set-v">{row.line}</span>
        {granted ? (
          <ConsentTextLink title={capabilityConsentDocument(row.capability, grantedVersion).title}>
            <ConsentItems capability={row.capability} versionId={grantedVersion} />
          </ConsentTextLink>
        ) : null}
        {failed && !asking && !revoking ? <ErrorLine text="Не сохранилось" /> : null}
      </div>
      <ConsentSwitch label={row.title} checked={granted} disabled={busy} onChange={toggle} />
      <RevokeDialog
        row={row}
        open={revoking}
        busy={busy}
        failed={failed}
        onRevoke={revoke}
        onClose={() => setRevoking(false)}
      />
      <ConsentDialog
        capability={row.capability}
        open={asking}
        busy={busy}
        failed={failed}
        onGrant={grant}
        onClose={() => setAsking(false)}
      />
    </li>
  );
}

interface StopDialogProps {
  readonly open: boolean;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onStop: () => void;
  readonly onClose: () => void;
}

/** N5c: подтверждение «Остановить всё». */
function StopDialog({ open, busy, failed, onStop, onClose }: StopDialogProps) {
  return (
    <Dialog open={open} title="Остановить всё?" onClose={onClose}>
      <p className="c5-lead">Остановятся автоотклики на hh.ru и публикации в LinkedIn.</p>
      {failed ? <ErrorLine text="Остановить не получилось" /> : null}
      <div className="actions">
        <button
          className="btn is-primary"
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={onStop}
        >
          <Icon name="pause" />
          Остановить всё
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Dialog>
  );
}

/** Выключенные действия включают над списком откликов — туда и ведёт строка (B774). */
function SetUpAutomation() {
  return (
    <div className="set-r">
      <Link className="btn is-sm" to={buildNodePath('o01')} aria-label="Настроить автоотклики">
        Настроить
      </Link>
    </div>
  );
}

/** «Действия от вашего имени»: остановить всё с подтверждением (N5c) и возобновить. */
function Automation({ state, onChanged }: { readonly state: AutomationState; readonly onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const { busy, failed, run } = useAction(() => {
    setAsking(false);
    onChanged();
  });
  const line = automationLine(state);
  return (
    <Group title="Действия от вашего имени">
      <li className="set-row">
        <div className="set-l">
          <span className="set-t">Автоотклики, комментарии в LinkedIn</span>
          <span className="set-v">{line.text}</span>
          {failed && !asking ? <ErrorLine text="Не получилось" /> : null}
        </div>
        {line.action ? (
          <div className="set-r">
            <button
              className="btn is-sm"
              type="button"
              disabled={busy}
              onClick={() => (line.action === 'stop' ? setAsking(true) : run(resumeCandidateAutomation))}
            >
              {line.action === 'stop' ? 'Остановить всё' : 'Возобновить'}
            </button>
          </div>
        ) : null}
        {line.text === 'выключены' ? <SetUpAutomation /> : null}
      </li>
      <StopDialog
        open={asking}
        busy={busy}
        failed={failed}
        onStop={() => run(() => pauseCandidateAutomation(STOP_DAYS))}
        onClose={() => setAsking(false)}
      />
    </Group>
  );
}

const EXPORT_FILE = 'openqareer-candidate-export.json';

/** Сохраняет выгрузку; `false` — в приложении окно сохранения закрыли без файла. */
async function downloadExport(): Promise<boolean> {
  const data = await exportCandidateData();
  const path = await triggerFileDownload(EXPORT_FILE, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
  return path !== null || !isTauriEnvironment();
}

/** «Ваши данные»: выгрузка файлом; ожидание, ошибка и результат — на месте строки. */
function Export() {
  const [done, setDone] = useState(false);
  const { busy, failed, run } = useAction(() => undefined);
  const save = () => run(async () => setDone(await downloadExport()));
  return (
    <Group title="Ваши данные">
      <li className="set-row">
        <div className="set-l">
          <span className="set-t">Выгрузка данных</span>
          {busy ? (
            <p className="st-var-line" role="status">
              <Icon name="clock" />
              <span>Выгрузка готовится</span>
            </p>
          ) : null}
          {failed ? <ErrorLine text="Выгрузка не получилась" /> : null}
          {done && !busy ? <ResultLine text="Файл сохранён" /> : null}
        </div>
        <div className="set-r">
          <button className="btn is-sm" type="button" disabled={busy} onClick={save}>
            Скачать мои данные
          </button>
        </div>
      </li>
    </Group>
  );
}

function Sections({ data, load }: { readonly data: AccountData; readonly load: Load<AccountData> }) {
  return (
    <>
      <Group title="На что вы дали согласие">
        <SearchConsentRow granted={data.searchConsent} onChanged={load.retry} />
        {CONSENT_ROWS.map((row) => (
          <Consent
            key={row.capability}
            row={row}
            grantedVersion={data.granted[row.capability]}
            onChanged={load.retry}
          />
        ))}
      </Group>
      {data.automation ? <Automation state={data.automation} onChanged={load.retry} /> : null}
      <Export />
      {data.deletion !== undefined ? <AccountDeletionGroup initial={data.deletion} /> : null}
    </>
  );
}

/** n05 «Согласия и данные»: согласия, «Остановить всё», выгрузка данных, удаление аккаунта. */
export function DataScreen({ node }: { readonly node: B640Node }) {
  const load = useLoad(loadData);
  return (
    <SettingsPage node={node} heading="Согласия и данные" busy={load.state === 'loading'}>
      {load.state === 'error' ? <ErrorLine text="Раздел не загрузился" onRetry={load.retry} /> : null}
      {load.state === 'ready' ? <Sections data={load.data} load={load} /> : null}
    </SettingsPage>
  );
}
