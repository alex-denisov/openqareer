import { lazy, Suspense, useState, type ReactNode } from 'react';
import {
  B640_HOME_PATH,
  B640_KIT_PATH,
  B640_TAB_SETS,
  buildNodePath,
  crumbLabel,
  crumbTrail,
  nodeByCode,
  type B640Match,
} from '../routes';
import { SECTION_ENTRIES } from '../sections';
import { BottomNav } from './BottomNav';
import { ChunkBoundary, ChunkView } from './ChunkBoundary';
import { Crumbs, type Crumb } from './Crumbs';
import { keepKeyOf, navOfTrail, type Journey } from './journey';
import { KeptScreen } from './KeptScreen';
import { NO_KEPT, nextKept } from './keptModel';
import { Link } from './Link';
import { backLabel } from './navigation';
import { ShellPanels } from './panels';
import { Rail } from './Rail';
import { isReturning } from './scrollMemory';
import { SecTabs, type SecTab } from './SecTabs';
import { useShell } from './ShellContext';
import { Topbar } from './Topbar';
import { useBellCount } from './useBellCount';

const Showcase = lazy(() => import('../kit/Showcase'));

function pathOrNull(code: string, params: Readonly<Record<string, string>>): string | null {
  try {
    return buildNodePath(code, params);
  } catch {
    return null;
  }
}

function trailOf(
  match: B640Match,
  lastLabel: string | undefined,
  journey: Journey | undefined,
): readonly Crumb[] {
  if (journey?.trail) {
    return [...journey.trail, { label: lastLabel ?? crumbLabel(match.node), path: null }];
  }
  const nodes = crumbTrail(match.node.code);
  return nodes.map((node, index) => {
    const last = index === nodes.length - 1;
    return {
      label: last && lastLabel ? lastLabel : crumbLabel(node),
      path: last ? null : pathOrNull(node.code, match.params),
    };
  });
}

function tabsOf(match: B640Match): { label: string; className?: string; tabs: SecTab[] } | null {
  const { node } = match;
  if (!node.tabs) return null;
  const tabSet = B640_TAB_SETS[node.tabs];
  const currentCode = node.tabOf ?? node.code;
  const tabs = tabSet.tabs.flatMap((tab) => {
    const path = pathOrNull(tab.code, { ...match.params, ...tab.params });
    const current = tab.code === currentCode;
    return path ? [{ label: tab.label, shortLabel: tab.shortLabel, path, current }] : [];
  });
  return { label: tabSet.label, className: tabSet.className, tabs };
}

function mobileBackOf(match: B640Match, trail: readonly Crumb[]) {
  const { node } = match;
  const hub = node.tabs ? B640_TAB_SETS[node.tabs].mobileHub : undefined;
  if (node.tabs && !hub) return null;
  const target = hub ? nodeByCode(hub) : undefined;
  if (target && target.code !== node.code) {
    return { path: buildNodePath(target.code), label: backLabel(crumbLabel(target)) };
  }
  const previous = trail.length > 1 ? trail[trail.length - 2] : null;
  return previous?.path ? { path: previous.path, label: backLabel(previous.label) } : null;
}

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || 'А';
}

function NotFound() {
  return (
    <div className="page" data-b640-node="not-found">
      <section className="b640-stub" aria-labelledby="b640-not-found">
        <h2 id="b640-not-found">Такой страницы нет</h2>
        <Link className="btn is-primary" to={B640_HOME_PATH}>
          Открыть «Сегодня»
        </Link>
      </section>
    </div>
  );
}

const pageFrame = (failure: ReactNode) => <div className="page">{failure}</div>;

/** Шапка отклика стоит в пути с первого кадра: путь не перестраивается после загрузки (B798). */
const CONTEXT_NODES: ReadonlySet<string> = new Set(['o02']);

/** Экран без сохранения: каждый адрес открывается заново. */
function Screen({ match, path }: { readonly match: B640Match; readonly path: string }) {
  const section = SECTION_ENTRIES[match.node.section];
  return (
    <ChunkBoundary chunk={section} resetKey={path} frame={pageFrame}>
      <Suspense fallback={<div className="page b640-loading" aria-busy="true" />}>
        <ChunkView key={path} chunk={section} props={{ node: match.node, params: match.params }} />
      </Suspense>
    </ChunkBoundary>
  );
}

/** Списки раздела: открытый на экране и оставленные под объектом. */
function KeptLists() {
  const { match, path, search } = useShell();
  const [state, setState] = useState(NO_KEPT);
  const target = { keepKey: keepKeyOf(path), path, search, match, returning: isReturning() };
  const kept = nextKept(state, target);
  if (kept !== state) setState(kept);
  return kept.entries.map((entry) => {
    const section = SECTION_ENTRIES[entry.match.node.section];
    return (
      <KeptScreen key={entry.id} active={entry.keepKey === kept.active}>
        <ChunkBoundary chunk={section} resetKey={entry.path} frame={pageFrame}>
          <ChunkView
            chunk={section}
            props={{ node: entry.match.node, params: entry.match.params }}
          />
        </ChunkBoundary>
      </KeptScreen>
    );
  });
}

/** Оболочка вокруг экрана: рейл, верхняя полоса, путь, вкладки, нижняя навигация. */
export function ShellFrame() {
  const { match, path, session, chrome, setCtxSlot, panel, journey } = useShell();
  const counted = useBellCount(path);
  const isKit = path.replace(/\/$/u, '') === B640_KIT_PATH;
  const node = match?.node ?? null;
  const trail = match ? trailOf(match, chrome.crumb, journey) : [];
  const tabs = match ? tabsOf(match) : null;
  const back = match ? mobileBackOf(match, trail) : null;
  const title = chrome.title ?? (isKit ? 'Общие компоненты' : (node?.title ?? 'Кабинет'));
  const bellCount = chrome.bellCount ?? counted.count;
  const active = navOfTrail(journey?.trail) ?? node?.nav ?? null;
  const contextHead = chrome.hasContextHead || CONTEXT_NODES.has(node?.code ?? '');

  return (
    <div className={panel?.kind === 'consultant' ? 'app has-panel' : 'app'} id="screen">
      <Rail active={active} />
      <Topbar
        title={title}
        titleTip={chrome.title ? undefined : chrome.titleTip}
        active={active}
        bellCount={bellCount}
        bellCritical={chrome.bellCritical ?? counted.critical}
        coachDot={chrome.coachDot ?? false}
        back={back}
      />
      <main className="main" id="career-main" tabIndex={-1}>
        {tabs ? null : (
          <Crumbs trail={trail} contextSlot={contextHead ? setCtxSlot : undefined} />
        )}
        {tabs ? <SecTabs label={tabs.label} tabs={tabs.tabs} className={tabs.className} /> : null}
        <Suspense fallback={<div className="page b640-loading" aria-busy="true" />}>
          {isKit ? <Showcase /> : null}
          {!isKit && !match ? <NotFound /> : null}
        </Suspense>
        <KeptLists />
        {match && !keepKeyOf(path) ? <Screen match={match} path={path} /> : null}
      </main>
      <ShellPanels nav={active} />
      <BottomNav
        active={active}
        bellCount={bellCount}
        initial={initialOf(session.displayName ?? session.username)}
      />
    </div>
  );
}
