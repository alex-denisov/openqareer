import { useEffect, useState, type ReactNode } from 'react';
import type { CampaignMetaView } from '../../coach/matchedVacancyApi';
import { SECTION_CACHE_KEYS } from '../../shell/sectionCache';
import { useShell } from '../shell/ShellContext';
import { Icon, Link } from '../kit';
import type { B640Node } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import {
  loadCampaign,
  loadRoles,
  loadSelectionTotal,
  loadSkillStrip,
  type RolesData,
} from './careerApi';
import { conditionsPath, pageAttrs } from './careerPaths';
import { RolePickLoad } from './RolePickDialog';
import { RoleTable } from './RoleTable';
import { searchStrip } from './rolesModel';
import { useCareerMark } from './loadMarks';
import { SkillStrip, SkillStripPlace } from './SkillStrip';

/** Ожидание и ошибка первого чтения ролей — на месте страницы. */
export function RolesLoad({
  node,
  state,
  children,
}: {
  readonly node: B640Node;
  readonly state?: string;
  readonly children: (data: RolesData, reload: () => void) => ReactNode;
}) {
  const load = useLoad(loadRoles, SECTION_CACHE_KEYS.careerRoles);
  if (load.state === 'ready') return <>{children(load.data, load.retry)}</>;
  return (
    <div className="page" {...pageAttrs(node, state)}>
      {load.state === 'loading' ? (
        <BlockSkeleton label="Подбираем роли" rows={3} />
      ) : (
        <BlockError text="Не удалось загрузить роли." onRetry={load.retry} />
      )}
    </div>
  );
}

/**
 * B768: число вакансий выбора догружается в полосу роли, таблица его не ждёт.
 * `undefined` — ещё считается (на месте числа скелетон), `null` — не прочиталось.
 */
function useSelectionTotal(
  titles: readonly string[],
  counting: boolean,
): number | null | undefined {
  const [total, setTotal] = useState<number | null | undefined>(undefined);
  const key = counting ? titles.join('\n') : null;
  useEffect(() => {
    setTotal(undefined);
    if (key === null) return undefined;
    const controller = new AbortController();
    void loadSelectionTotal(key ? key.split('\n') : [], controller.signal).then((value) => {
      if (!controller.signal.aborted) setTotal(value);
    });
    return () => controller.abort();
  }, [key]);
  return total;
}

/** B792: место числа вакансий, пока подборка считается (на проде до 15 с). */
function CountPlace() {
  useCareerMark('skeleton');
  return (
    <span
      className="ls-bar role-strip-sk role-strip-sk-n"
      role="status"
      aria-busy="true"
      aria-label="Считаем вакансии"
    />
  );
}

/** B792: каркас полосы роли поиска до ответа кампании — подпись на месте, роль скелетоном. */
export function RoleStripPlace() {
  useCareerMark('skeleton');
  return (
    <section className="role-strip" role="status" aria-busy="true" aria-label="Роль поиска">
      <p className="role-strip-t">
        <span className="role-strip-k">Роль поиска</span>
        <span className="ls-bar role-strip-sk" />
      </p>
    </section>
  );
}

function SearchRoleStrip({
  campaign,
  counting,
  onEdit,
}: {
  readonly campaign: CampaignMetaView;
  /** Число вакансий спрашиваем после таблицы: расчёт подборки её задержал бы. */
  readonly counting: boolean;
  readonly onEdit: () => void;
}) {
  const titles = campaign.roles.value;
  const total = useSelectionTotal(titles, counting);
  const strip = searchStrip(titles, total ?? null, campaign.titlesRu);
  useCareerMark('role');
  useCareerMark('count', Boolean(strip?.count));
  return (
    <section className="role-strip" aria-labelledby="role-title">
      <p className="role-strip-t">
        <span className="role-strip-k">Роль поиска</span>
        <span className="role-strip-r" role="heading" aria-level={2} id="role-title">
          {strip?.title ?? 'не выбрана'}
        </span>
        {strip && total === undefined ? <CountPlace /> : null}
        {strip?.count ? <span className="role-strip-n num">{strip.count}</span> : null}
      </p>
      <button className="row-act role-strip-b" type="button" onClick={onEdit}>
        <Icon name="edit" />
        {strip ? 'Изменить' : 'Выбрать'}
      </button>
    </section>
  );
}

/** Полоса «Проверьте N навыков» читается отдельно: таблица ролей её не ждёт. */
function SkillStripLoad() {
  const strip = useLoad(loadSkillStrip, SECTION_CACHE_KEYS.careerSkills);
  if (strip.state === 'loading') return <SkillStripPlace />;
  if (strip.state !== 'ready' || !strip.data) return null;
  return <SkillStrip gap={strip.data.gap} role={strip.data.role} />;
}

/**
 * S9 «Карьера» при «Ищу работу»: роль поиска, проверка навыков, роли по профилю.
 * B792: полоса роли и таблица читаются независимо; полоса навыков ждёт таблицу.
 * Пока часть читается, на её месте каркас: роль поиска, число вакансий, роли.
 */
export function RolesView({ node }: { readonly node: B640Node }) {
  const { search } = useShell();
  // «Выбрать роль» из проверки навыков открывает выбор роли поиска сразу (B645).
  const [picking, setPicking] = useState(() => new URLSearchParams(search).get('pick') === '1');
  const campaign = useLoad(loadCampaign, SECTION_CACHE_KEYS.careerCampaign);
  const roles = useLoad(loadRoles, SECTION_CACHE_KEYS.careerRoles);
  const data = roles.state === 'ready' ? roles.data : null;
  const meta = data?.campaign ?? (campaign.state === 'ready' ? campaign.data : null);
  useCareerMark('roles', data !== null);
  return (
    <div className="page" {...pageAttrs(node)}>
      {meta ? (
        <SearchRoleStrip campaign={meta} counting={data !== null} onEdit={() => setPicking(true)} />
      ) : campaign.state === 'loading' ? (
        <RoleStripPlace />
      ) : null}
      {data ? <SkillStripLoad /> : <SkillStripPlace />}
      {data ? <RoleTable rows={data.rows} /> : null}
      {roles.state === 'loading' ? <BlockSkeleton label="Подбираем роли" rows={3} /> : null}
      {roles.state === 'error' ? (
        <BlockError text="Не удалось загрузить роли." onRetry={roles.retry} />
      ) : null}
      <Link className="row-act is-sm" to={conditionsPath()}>
        <Icon name="sliders" />
        Условия поиска
      </Link>
      {picking && data ? <RolePickLoad rows={data.rows} onClose={() => setPicking(false)} /> : null}
    </div>
  );
}
