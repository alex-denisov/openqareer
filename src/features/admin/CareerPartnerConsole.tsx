import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { APPLICATION_STAGES, type ApplicationStage } from '../../../shared/applicationStage';
import { CANDIDATE_REGION_CATALOGUE, type CandidateRegion } from '../workspace/candidateRegions';
import {
  getCareerPartnerCampaign,
  getCareerPartnerCandidate,
  listCareerPartnerCandidates,
  updateCareerPartnerCampaign,
  type CareerPartnerCampaign,
  type CareerPartnerCandidate,
  type CareerPartnerCandidateDirectory,
  type CareerPartnerCandidateProfile,
} from './adminApi';

const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  saved: 'Сохранено',
  applied: 'Отклик отправлен',
  responded: 'Ответ',
  interview: 'Интервью',
  offer: 'Предложение',
  rejected: 'Отказ',
  archived: 'Архив',
};

type DirectoryState =
  | { status: 'loading' }
  | { status: 'ready'; page: CareerPartnerCandidateDirectory }
  | { status: 'failed'; message: string };

function usePartnerDirectory() {
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<DirectoryState>({ status: 'loading' });
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: 'loading' });
      try {
        const page = await listCareerPartnerCandidates({ offset, signal });
        if (!signal?.aborted) setState({ status: 'ready', page });
      } catch (reason: unknown) {
        if (!signal?.aborted) {
          setState({
            status: 'failed',
            message: reason instanceof Error ? reason.message : 'Не удалось загрузить список.',
          });
        }
      }
    },
    [offset],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { offset, setOffset, state, retry: () => void load() };
}

export function CareerPartnerConsole() {
  const directory = usePartnerDirectory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const page = directory.state.status === 'ready' ? directory.state.page : null;

  useEffect(() => {
    if (page?.items.length && !page.items.some((item) => item.userId === selectedId)) {
      setSelectedId(page.items[0].userId);
    }
    if (page && page.items.length === 0) setSelectedId(null);
  }, [page, selectedId]);

  return (
    <section className="career-partner-view" aria-labelledby="career-partner-title">
      <header className="career-partner-heading">
        <p className="admin-eyebrow">Карьерное сопровождение</p>
        <h1 id="career-partner-title">Закреплённые кандидаты</h1>
        <p className="admin-note">Профили, резюме и воронка откликов по вашим кандидатам.</p>
      </header>
      <PartnerDirectory
        state={directory.state}
        offset={directory.offset}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOffset={directory.setOffset}
        onRetry={directory.retry}
      />
      {page?.permissions && selectedId && (
        <PartnerCandidateProfile
          key={selectedId}
          candidateUserId={selectedId}
          canEditCampaigns={page.permissions.can_edit_campaigns}
        />
      )}
    </section>
  );
}

function PartnerDirectory({
  state,
  offset,
  selectedId,
  onSelect,
  onOffset,
  onRetry,
}: {
  state: DirectoryState;
  offset: number;
  selectedId: string | null;
  onSelect: (candidateUserId: string) => void;
  onOffset: (offset: number | ((current: number) => number)) => void;
  onRetry: () => void;
}) {
  if (state.status === 'loading') return <PartnerDirectoryLoading />;
  if (state.status === 'failed')
    return <PartnerDirectoryError message={state.message} onRetry={onRetry} />;
  if (state.page.total === 0)
    return <p className="admin-note">Пока нет закреплённых кандидатов.</p>;
  return (
    <PartnerDirectoryReady
      page={state.page}
      offset={offset}
      selectedId={selectedId}
      onSelect={onSelect}
      onOffset={onOffset}
    />
  );
}

function PartnerDirectoryLoading() {
  return (
    <p className="admin-note" aria-busy="true">
      Загружаем список кандидатов…
    </p>
  );
}

function PartnerDirectoryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="admin-error" role="alert">
      <p>{message}</p>
      <button className="admin-quiet-button" type="button" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

function PartnerDirectoryReady({
  page,
  offset,
  selectedId,
  onSelect,
  onOffset,
}: {
  page: CareerPartnerCandidateDirectory;
  offset: number;
  selectedId: string | null;
  onSelect: (candidateUserId: string) => void;
  onOffset: (offset: number | ((current: number) => number)) => void;
}) {
  return (
    <>
      <nav className="career-partner-candidates" aria-label="Список закреплённых кандидатов">
        {page.items.map((candidate) => (
          <CandidateButton
            candidate={candidate}
            selected={selectedId === candidate.userId}
            key={candidate.userId}
            onSelect={onSelect}
          />
        ))}
      </nav>
      <nav className="career-partner-pagination" aria-label="Страницы кандидатов">
        <button
          className="admin-quiet-button"
          type="button"
          disabled={offset === 0}
          onClick={() => onOffset(Math.max(0, offset - 20))}
        >
          Назад
        </button>
        <span>
          Показано {Math.min(offset + page.items.length, page.total)} из {page.total}
        </span>
        <button
          className="admin-quiet-button"
          type="button"
          disabled={page.nextOffset === null}
          onClick={() => onOffset(page.nextOffset ?? offset)}
        >
          Далее
        </button>
      </nav>
    </>
  );
}

function CandidateButton({
  candidate,
  selected,
  onSelect,
}: {
  candidate: CareerPartnerCandidate;
  selected: boolean;
  onSelect: (candidateUserId: string) => void;
}) {
  return (
    <button
      className={`career-partner-candidate${selected ? ' is-selected' : ''}`}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(candidate.userId)}
    >
      <strong>{candidate.displayName ?? 'Имя не указано'}</strong>
      <span>{candidate.headline ?? 'Позиция не указана'}</span>
      <small>{candidate.location ?? 'Локация не указана'}</small>
    </button>
  );
}

function usePartnerCandidateProfile(candidateUserId: string) {
  const [profile, setProfile] = useState<CareerPartnerCandidateProfile | null>(null);
  const [campaign, setCampaign] = useState<CareerPartnerCampaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getCareerPartnerCandidate(candidateUserId),
      getCareerPartnerCampaign(candidateUserId),
    ])
      .then(([nextProfile, nextCampaign]) => {
        if (active) {
          setProfile(nextProfile);
          setCampaign(nextCampaign);
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Не удалось открыть профиль.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [candidateUserId]);

  return { profile, campaign, error, loading, setCampaign };
}

function PartnerCandidateProfile({
  candidateUserId,
  canEditCampaigns,
}: {
  candidateUserId: string;
  canEditCampaigns: boolean;
}) {
  const state = usePartnerCandidateProfile(candidateUserId);

  if (state.loading)
    return (
      <p className="admin-note" aria-busy="true">
        Загружаем профиль кандидата…
      </p>
    );
  if (state.error || !state.profile || !state.campaign)
    return (
      <p className="admin-alert admin-alert--error" role="alert">
        {state.error ?? 'Профиль кандидата недоступен.'}
      </p>
    );
  return (
    <article className="career-partner-profile" aria-labelledby="partner-candidate-name">
      <header className="career-partner-profile__header">
        <div>
          <h2 id="partner-candidate-name">
            {state.profile.candidate.displayName ?? 'Имя не указано'}
          </h2>
          <p className="admin-note">
            {state.profile.candidate.headline ?? 'Позиция не указана'} ·{' '}
            {state.profile.candidate.location ?? 'Локация не указана'}
          </p>
        </div>
      </header>
      <ResumePanel resume={state.profile.resume} />
      <ApplicationFunnelPanel profile={state.profile} />
      <CampaignPanel
        candidateUserId={candidateUserId}
        campaign={state.campaign}
        canEdit={canEditCampaigns}
        onSaved={state.setCampaign}
      />
    </article>
  );
}

function ResumePanel({ resume }: { resume: CareerPartnerCandidateProfile['resume'] }) {
  if (!resume) {
    return (
      <section className="career-partner-section">
        <h3>Резюме</h3>
        <p className="admin-note">Резюме не сохранено.</p>
      </section>
    );
  }
  const draft = resume.draft;
  return (
    <section className="career-partner-section" aria-labelledby="partner-resume-title">
      <h3 id="partner-resume-title">Резюме</h3>
      {draft.candidate.about && <p>{draft.candidate.about}</p>}
      <dl className="career-partner-resume-summary">
        <div>
          <dt>Целевая роль</dt>
          <dd>{draft.targetRole ?? 'Не указана'}</dd>
        </div>
        <div>
          <dt>Мест работы</dt>
          <dd>{draft.experience.length}</dd>
        </div>
        <div>
          <dt>Навыки</dt>
          <dd>{draft.skills?.map((skill) => skill.name).join(', ') || 'Не указаны'}</dd>
        </div>
      </dl>
      {draft.experience.length > 0 && <p className="career-partner-subheading">Места работы</p>}
      {draft.experience.length > 0 && (
        <ul className="career-partner-experience">
          {draft.experience.map((experience) => (
            <li key={experience.id}>
              <strong>{experience.title ?? 'Роль не указана'}</strong>
              <span>{experience.employer ?? 'Работодатель не указан'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ApplicationFunnelPanel({ profile }: { profile: CareerPartnerCandidateProfile }) {
  const counts = APPLICATION_STAGES.filter((stage) => profile.applications.funnel[stage] > 0);
  return (
    <section className="career-partner-section" aria-labelledby="partner-applications-title">
      <h3 id="partner-applications-title">Отклики</h3>
      <p className="admin-note">Всего записей: {profile.applications.total}</p>
      {counts.length === 0 ? (
        <p>Отклики не зарегистрированы.</p>
      ) : (
        <dl className="career-partner-funnel">
          {counts.map((stage) => (
            <div key={stage}>
              <dt>{APPLICATION_STAGE_LABELS[stage]}</dt>
              <dd>{profile.applications.funnel[stage]}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function CampaignPanel({
  candidateUserId,
  campaign,
  canEdit,
  onSaved,
}: {
  candidateUserId: string;
  campaign: CareerPartnerCampaign;
  canEdit: boolean;
  onSaved: (campaign: CareerPartnerCampaign) => void;
}) {
  return (
    <section className="career-partner-section" aria-labelledby="partner-campaign-title">
      <h3 id="partner-campaign-title">Кампания поиска</h3>
      {canEdit ? (
        <CampaignEditor candidateUserId={candidateUserId} campaign={campaign} onSaved={onSaved} />
      ) : (
        <>
          <p className="admin-note">
            Право редактирования не выдано. Кампания доступна для просмотра.
          </p>
          <CampaignSummary campaign={campaign} />
        </>
      )}
    </section>
  );
}

function useCampaignEditor(
  candidateUserId: string,
  campaign: CareerPartnerCampaign,
  onSaved: (campaign: CareerPartnerCampaign) => void,
) {
  const [rolesText, setRolesText] = useState(campaign.roles.value.join('\n'));
  const [regions, setRegions] = useState<CandidateRegion[]>(
    campaign.regions.value as CandidateRegion[],
  );
  const [remoteOnly, setRemoteOnly] = useState(campaign.remoteOnly);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRolesText(campaign.roles.value.join('\n'));
    setRegions(campaign.regions.value as CandidateRegion[]);
    setRemoteOnly(campaign.remoteOnly);
  }, [campaign]);

  const toggleRegion = (region: CandidateRegion, selected: boolean) => {
    setRegions((current) =>
      selected ? [...new Set([...current, region])] : current.filter((item) => item !== region),
    );
  };

  const save = (event: FormEvent) =>
    saveCampaign(event, candidateUserId, rolesText, regions, remoteOnly, onSaved, {
      setSaving,
      setError,
      setSaved,
    });

  return {
    rolesText,
    setRolesText,
    regions,
    remoteOnly,
    setRemoteOnly,
    saving,
    error,
    saved,
    toggleRegion,
    save,
  };
}

async function saveCampaign(
  event: FormEvent,
  candidateUserId: string,
  rolesText: string,
  regions: CandidateRegion[],
  remoteOnly: boolean,
  onSaved: (campaign: CareerPartnerCampaign) => void,
  setters: {
    setSaving: (saving: boolean) => void;
    setError: (error: string | null) => void;
    setSaved: (saved: boolean) => void;
  },
): Promise<void> {
  event.preventDefault();
  const roles = rolesText
    .split('\n')
    .map((role) => role.trim())
    .filter(Boolean);
  if (roles.length > 10 || roles.some((role) => role.length > 200)) {
    setters.setError('Укажите не более 10 ролей длиной до 200 символов.');
    setters.setSaved(false);
    return;
  }
  setters.setSaving(true);
  setters.setError(null);
  setters.setSaved(false);
  try {
    onSaved(await updateCareerPartnerCampaign(candidateUserId, { roles, regions, remoteOnly }));
    setters.setSaved(true);
  } catch (reason: unknown) {
    setters.setError(reason instanceof Error ? reason.message : 'Не удалось сохранить кампанию.');
  } finally {
    setters.setSaving(false);
  }
}

function CampaignEditor({
  candidateUserId,
  campaign,
  onSaved,
}: {
  candidateUserId: string;
  campaign: CareerPartnerCampaign;
  onSaved: (campaign: CareerPartnerCampaign) => void;
}) {
  const editor = useCampaignEditor(candidateUserId, campaign, onSaved);
  return (
    <form
      className="career-partner-campaign-form"
      onSubmit={(event) => void editor.save(event)}
      aria-busy={editor.saving}
    >
      <CampaignEditorFields editor={editor} />
      <CampaignEditorStatus editor={editor} />
    </form>
  );
}

function CampaignEditorFields({ editor }: { editor: ReturnType<typeof useCampaignEditor> }) {
  return (
    <>
      <label htmlFor="partner-campaign-roles">Целевые роли</label>
      <textarea
        id="partner-campaign-roles"
        className="admin-textarea"
        value={editor.rolesText}
        onChange={(event) => editor.setRolesText(event.target.value)}
        disabled={editor.saving}
      />
      <CampaignRegionChoices
        regions={editor.regions}
        saving={editor.saving}
        onToggle={editor.toggleRegion}
      />
      <label className="career-partner-remote-choice">
        <input
          type="checkbox"
          checked={editor.remoteOnly}
          onChange={(event) => editor.setRemoteOnly(event.currentTarget.checked)}
          disabled={editor.saving}
        />
        Только удалённая работа
      </label>
    </>
  );
}

function CampaignEditorStatus({ editor }: { editor: ReturnType<typeof useCampaignEditor> }) {
  return (
    <>
      <button type="submit" className="admin-btn" disabled={editor.saving}>
        {editor.saving ? 'Сохраняем…' : 'Сохранить кампанию'}
      </button>
      {editor.saved && (
        <p className="career-partner-save-status" role="status">
          Кампания сохранена.
        </p>
      )}
      {editor.error && (
        <p className="admin-alert admin-alert--error" role="alert">
          {editor.error}
        </p>
      )}
    </>
  );
}

function CampaignRegionChoices({
  regions,
  saving,
  onToggle,
}: {
  regions: readonly CandidateRegion[];
  saving: boolean;
  onToggle: (region: CandidateRegion, selected: boolean) => void;
}) {
  return (
    <fieldset className="career-partner-region-list" disabled={saving}>
      <legend>Регионы</legend>
      {CANDIDATE_REGION_CATALOGUE.map((region) => (
        <label key={region.id}>
          <input
            type="checkbox"
            checked={regions.includes(region.id)}
            onChange={(event) => onToggle(region.id, event.currentTarget.checked)}
          />
          {region.label}
        </label>
      ))}
    </fieldset>
  );
}

function CampaignSummary({ campaign }: { campaign: CareerPartnerCampaign }) {
  const regions = campaign.regions.value
    .map((region) => CANDIDATE_REGION_CATALOGUE.find((item) => item.id === region)?.label ?? region)
    .join(', ');
  return (
    <dl className="career-partner-resume-summary">
      <div>
        <dt>Роли</dt>
        <dd>{campaign.roles.value.join(', ') || 'Не выбраны'}</dd>
      </div>
      <div>
        <dt>Регионы</dt>
        <dd>{regions || 'Не выбраны'}</dd>
      </div>
      <div>
        <dt>Только удалённая работа</dt>
        <dd>{campaign.remoteOnly ? 'Да' : 'Нет'}</dd>
      </div>
    </dl>
  );
}
