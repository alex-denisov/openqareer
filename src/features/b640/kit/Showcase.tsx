import {
  ComposerSection,
  DialogSection,
  DockSection,
  PagedSection,
  ResultSection,
  SettingsSection,
  ToastSection,
} from './showcaseSections';
import {
  ButtonSection,
  FormRowSection,
  RowActionSection,
  ThemeSection,
  TipSection,
} from './showcaseControls';

/** Страница-витрина общих компонентов: `/app/kit`; `?open=dialog` и `?open=toast` — для снимков. */
export default function Showcase() {
  const open = new URLSearchParams(window.location.search).get('open');
  return (
    <div className="page" data-b640-kit>
      <SettingsSection />
      <PagedSection />
      <ToastSection autoOpen={open === 'toast'} />
      <ResultSection />
      <DialogSection autoOpen={open === 'dialog'} />
      <TipSection />
      <ComposerSection />
      <DockSection />
      <RowActionSection />
      <ButtonSection />
      <FormRowSection />
      <ThemeSection />
    </div>
  );
}
