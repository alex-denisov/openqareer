import { lazy, Suspense } from 'react';
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
import { Crumbs, type Crumb } from './Crumbs';
import { Link } from './Link';
import { backLabel } from './navigation';
import { Rail } from './Rail';
import { SecTabs, type SecTab } from './SecTabs';
import { useShell } from './ShellContext';
import { Topbar } from './Topbar';

const Showcase = lazy(() => import('../kit/Showcase'));

function pathOrNull(code: string, params: Readonly<Record<string, string>>): string | null {
  try {
    return buildNodePath(code, params);
  } catch {
    return null;
  }
}

function trailOf(match: B640Match, lastLabel: string | undefined): readonly Crumb[] {
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
    return path ? [{ label: tab.label, path, current: tab.code === currentCode }] : [];
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

/** Оболочка вокруг экрана: рейл, верхняя полоса, путь, вкладки, нижняя навигация. */
export function ShellFrame() {
  const { match, path, session, chrome, setCtxSlot } = useShell();
  const isKit = path.replace(/\/$/u, '') === B640_KIT_PATH;
  const node = match?.node ?? null;
  const trail = match ? trailOf(match, chrome.crumb) : [];
  const tabs = match ? tabsOf(match) : null;
  const back = match ? mobileBackOf(match, trail) : null;
  const title = chrome.title ?? (isKit ? 'Общие компоненты' : (node?.title ?? 'Кабинет'));
  const bellCount = chrome.bellCount ?? 0;
  const Section = node ? SECTION_ENTRIES[node.section] : null;

  return (
    <div className={chrome.hasPanel ? 'app has-panel' : 'app'} id="screen">
      <Rail active={node?.nav ?? null} />
      <Topbar
        title={title}
        active={node?.nav ?? null}
        bellCount={bellCount}
        bellCritical={chrome.bellCritical ?? false}
        coachDot={chrome.coachDot ?? false}
        back={back}
      />
      <main className="main" id="career-main" tabIndex={-1}>
        {tabs ? null : (
          <Crumbs trail={trail} contextSlot={chrome.hasContextHead ? setCtxSlot : undefined} />
        )}
        {tabs ? <SecTabs label={tabs.label} tabs={tabs.tabs} className={tabs.className} /> : null}
        <Suspense fallback={<div className="page b640-loading" aria-busy="true" />}>
          {isKit ? <Showcase /> : null}
          {!isKit && match && Section ? (
            <Section key={path} node={match.node} params={match.params} />
          ) : null}
          {!isKit && !match ? <NotFound /> : null}
        </Suspense>
      </main>
      <BottomNav
        active={node?.nav ?? null}
        bellCount={bellCount}
        initial={initialOf(session.displayName ?? session.username)}
      />
    </div>
  );
}
