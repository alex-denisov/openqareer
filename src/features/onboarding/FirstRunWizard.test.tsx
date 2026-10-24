import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstRunWizard, type FirstRunWizardProps } from './FirstRunWizard';
import { FirstRunSourceMenu } from './FirstRunSourceMenu';
import { FirstRunCitySheet } from './FirstRunCitySheet';
import { FirstRunSkipDialog, FirstRunSkippedToast } from './FirstRunSkipDialog';
import { FirstRunEmptySources, FirstRunErrorState } from './FirstRunStates';

function renderWizard(
  props: Omit<FirstRunWizardProps, 'onOpenConsultant'> &
    Partial<Pick<FirstRunWizardProps, 'onOpenConsultant'>> = {},
): string {
  const { onOpenConsultant, ...wizardProps } = props;
  return renderToStaticMarkup(
    <FirstRunWizard {...wizardProps} onOpenConsultant={onOpenConsultant ?? (() => undefined)} />,
  );
}

describe('FirstRunWizard component tests', () => {
  it('starts a new candidate with an empty goal instead of demo facts', () => {
    const html = renderWizard();
    expect(html).toContain('data-testid="goal-textarea"');
    expect(html).not.toContain('Хочу понять, на какие руководящие роли');
    expect(html).not.toContain('data-testid="source-skip-btn"');
  });

  it('renders the source step with all available paths', () => {
    const html = renderWizard({ initialStep: 'source' });
    expect(html).toContain('Находка себя');
    expect(html).toContain('Цель');
    expect(html).toContain('Источник');
    expect(html).toContain('LinkedIn');
    expect(html).toContain('hh.ru');
    expect(html).toContain('Файл резюме');
    expect(html).toContain('Рассказать консультанту');
    expect(html).toContain('Можно подключить LinkedIn или hh.ru');
    expect(html).toContain('Какие источники можно подключить?');
  });

  it('renders context with city, work format and relocation', () => {
    const html = renderWizard({ initialStep: 'context' });
    expect(html).toContain('Контекст');
    expect(html).toContain('Город и формат работы нужны для подбора');
    expect(html).toContain('Выбрать город');
    expect(html).toContain('Не указан');
    expect(html).toContain('Гибрид');
    expect(html).toContain('Готов к релокации');
    expect(html).toContain('Собрать профиль');
  });

  it('names the subject and step while a connected source is read for long', () => {
    const html = renderWizard({
      initialStep: 'source',
      importProgressLabel: 'Читаем LinkedIn: раздел 2 из 5',
    });
    expect(html).toContain('Читаем LinkedIn: раздел 2 из 5');
    expect(html).not.toContain('Собираем');
  });

  it('renders the server error with a single retry and no sign-in link', () => {
    const html = renderToStaticMarkup(<FirstRunErrorState onRetry={() => undefined} />);
    expect(html).toContain('Не удалось войти: сервер не ответил. Данные не потеряны.');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('Открыть вход');
  });

  it('renders the empty-source note with the consultant action', () => {
    const html = renderToStaticMarkup(<FirstRunEmptySources onConsultant={() => undefined} />);
    expect(html).toContain(
      'Источник не выбран. Можно рассказать консультанту, профиль соберётся из ответов.',
    );
    expect(html).toContain('Рассказать консультанту');
  });

  it('renders only the working file choice and a PDF file input', () => {
    const html = renderToStaticMarkup(
      <FirstRunSourceMenu isOpen onClose={() => undefined} onPickFile={() => undefined} />,
    );
    expect(html).toContain('Выбрать в «Файлах»');
    expect(html).not.toContain('Фото из библиотеки');
    expect(html).not.toContain('Сканировать документ');
    expect(html).not.toContain('пока недоступн');
    expect(html).toContain(
      'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx',
    );
    expect(html).toContain('Отмена');
  });

  it('renders the city sheet search and region-aware city list', () => {
    const html = renderToStaticMarkup(
      <FirstRunCitySheet
        isOpen
        selectedCity="Москва"
        onClose={() => undefined}
        onSelectCity={() => undefined}
      />,
    );
    expect(html).toContain('Поиск города');
    expect(html).toContain('Москва');
    expect(html).toContain('Санкт-Петербург');
    expect(html).toContain('Белград');
  });

  it('renders skip confirmation and undo state', () => {
    const dialog = renderToStaticMarkup(
      <FirstRunSkipDialog isOpen onCancel={() => undefined} onConfirm={() => undefined} />,
    );
    const toast = renderToStaticMarkup(<FirstRunSkippedToast isVisible onUndo={() => undefined} />);
    expect(dialog).toContain('Пропустить шаг «Источник»?');
    expect(dialog).toContain('Вернуться');
    expect(dialog).toContain('Пропустить');
    expect(toast).toContain('Источник пропущен. Подключить можно в «Аккаунт → Подключения».');
    expect(toast).toContain('Вернуть');
  });

  it('exposes the mobile layout state supplied by the shell media query', () => {
    const html = renderWizard({ isMobile: true, initialStep: 'source' });
    expect(html).toContain('data-mobile="true"');
    expect(html).toContain('Шаг 2 из 3');
    expect(html).toContain('Файл резюме');
    expect(html).not.toContain('first-run-consultant-sidebar');
  });

  it('renders the partial-sources note from the step «Источник» on', () => {
    const message = 'LinkedIn подключён, hh.ru нет: доступно после подключения hh.ru.';
    expect(renderWizard({ initialStep: 'source', partialSourcesMessage: message })).toContain(
      message,
    );
    expect(renderWizard({ partialSourcesMessage: message })).not.toContain(message);
    expect(renderWizard({ initialStep: 'source' })).not.toContain('first-run-partial-sources');
  });

  it('renders all mockup starter prompts in consultant sidebar', () => {
    const html = renderWizard({ initialStep: 'source' });
    expect(html).toContain('С чего начать?');
    expect(html).toContain('Что вы читаете в LinkedIn?');
    expect(html).toContain('Можно без LinkedIn?');
  });
});
