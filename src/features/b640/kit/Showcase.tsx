import { useShell } from '../shell/ShellContext';
import { SecTabs, type SecTab } from '../shell/SecTabs';
import {
  ButtonSection,
  FormRowSection,
  RowActionSection,
  ThemeSection,
  TipSection,
} from './showcaseControls';
import {
  ComposerSection,
  DialogSection,
  DockSection,
  PagedSection,
  ResultSection,
  SettingsSection,
  ToastSection,
} from './showcaseSections';

const VIEWS = [
  { id: 'main', label: 'Основное', path: '/app/kit' },
  { id: 'buttons', label: 'Кнопки', path: '/app/kit?view=buttons' },
  { id: 'composer', label: 'Панель ввода', path: '/app/kit?view=composer' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

function readView(search: string): ViewId {
  const value = new URLSearchParams(search).get('view');
  return VIEWS.find((view) => view.id === value)?.id ?? 'main';
}

function MainView({ open }: { readonly open: string | null }) {
  return (
    <>
      <SettingsSection />
      <PagedSection />
      <ToastSection autoOpen={open === 'toast'} />
      <ResultSection />
      <DialogSection autoOpen={open === 'dialog'} />
      <TipSection />
      <RowActionSection />
      <FormRowSection />
      <ThemeSection />
      <DockSection title="Закреплённая главная кнопка" />
    </>
  );
}

function ButtonsView() {
  return (
    <>
      <ButtonSection />
      <DockSection title="Главная кнопка в закреплённой полосе" />
    </>
  );
}

/**
 * Витрина общих компонентов: `/app/kit`. Каждый вид — отдельный экран:
 * `?view=buttons`, `?view=composer`; `?open=dialog` и `?open=toast` — для снимков.
 */
export default function Showcase() {
  const { search } = useShell();
  const params = new URLSearchParams(search);
  const view = readView(search);
  const tabs: readonly SecTab[] = VIEWS.map((item) => ({
    label: item.label,
    path: item.path,
    current: item.id === view,
  }));
  return (
    <div className="page" data-b640-kit>
      <SecTabs label="Виды витрины" tabs={tabs} />
      {view === 'main' ? <MainView open={params.get('open')} /> : null}
      {view === 'buttons' ? <ButtonsView /> : null}
      {view === 'composer' ? <ComposerSection /> : null}
    </div>
  );
}
