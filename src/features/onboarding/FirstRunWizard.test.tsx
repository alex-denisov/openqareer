import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstRunWizard } from './FirstRunWizard';
import { FirstRunSourceMenu } from './FirstRunSourceMenu';
import { FirstRunCitySheet } from './FirstRunCitySheet';
import { FirstRunSkipDialog, FirstRunSkippedToast } from './FirstRunSkipDialog';

describe('FirstRunWizard component tests', () => {
  it('renders Step 2 (Source) with 4 options and consultant starters', () => {
    const html = renderToStaticMarkup(<FirstRunWizard initialStep="source" isMobile={false} />);
    expect(html).toContain('Находка себя');
    expect(html).toContain('Цель');
    expect(html).toContain('Источник');
    expect(html).toContain('LinkedIn');
    expect(html).toContain('hh.ru');
    expect(html).toContain('Файл резюме');
    expect(html).toContain('Рассказать консультанту');
    expect(html).toContain('С чего начать?');
    expect(html).toContain('Что вы читаете в LinkedIn?');
    expect(html).toContain('Можно без LinkedIn?');
  });

  it('renders Step 3 (Context) with city selector, work format and relocation', () => {
    const html = renderToStaticMarkup(<FirstRunWizard initialStep="context" isMobile={false} />);
    expect(html).toContain('Контекст');
    expect(html).toContain('Город и формат работы нужны для подбора');
    expect(html).toContain('Москва');
    expect(html).toContain('Гибрид');
    expect(html).toContain('Готов к релокации');
    expect(html).toContain('Собрать профиль');
  });

  it('renders skeleton special state', () => {
    const html = renderToStaticMarkup(<FirstRunWizard specialState="skeleton" />);
    expect(html).toContain('Проверяем вход и читаем ваш профиль');
  });

  it('renders stale-loading special state', () => {
    const html = renderToStaticMarkup(<FirstRunWizard specialState="stale-loading" />);
    expect(html).toContain('Читаем LinkedIn: раздел 2 из 5');
    expect(html).toContain('Подпись называет субъект и шаг, а не «Собираем»');
  });

  it('renders error special state with retry button', () => {
    const html = renderToStaticMarkup(<FirstRunWizard specialState="error" />);
    expect(html).toContain('Не удалось войти: сервер не ответил. Данные не потеряны.');
    expect(html).toContain('Повторить');
  });

  it('renders session-expired special state with signin button', () => {
    const html = renderToStaticMarkup(<FirstRunWizard specialState="session-expired" />);
    expect(html).toContain('Вход устарел. Войдите снова, один раз для всего приложения.');
    expect(html).toContain('Войти');
  });

  it('renders empty-sources and partial-source banners', () => {
    const emptyHtml = renderToStaticMarkup(<FirstRunWizard specialState="empty-sources" />);
    expect(emptyHtml).toContain('Источник не выбран. Можно рассказать консультанту');

    const partialHtml = renderToStaticMarkup(<FirstRunWizard specialState="partial-source" />);
    expect(partialHtml).toContain('LinkedIn подключён, hh.ru нет');
  });

  it('renders FirstRunSourceMenu with 3 mobile upload options', () => {
    const html = renderToStaticMarkup(
      <FirstRunSourceMenu isOpen={true} onClose={() => {}} onPickFile={() => {}} />,
    );
    expect(html).toContain('Выбрать в «Файлах»');
    expect(html).toContain('Фото из библиотеки');
    expect(html).toContain('Сканировать документ');
    expect(html).toContain('Отмена');
  });

  it('renders FirstRunCitySheet with popular cities and search input', () => {
    const html = renderToStaticMarkup(
      <FirstRunCitySheet isOpen={true} selectedCity="Москва" onClose={() => {}} onSelectCity={() => {}} />,
    );
    expect(html).toContain('Поиск города');
    expect(html).toContain('Москва');
    expect(html).toContain('Санкт-Петербург');
    expect(html).toContain('Белград');
  });

  it('renders FirstRunSkipDialog and FirstRunSkippedToast', () => {
    const dialogHtml = renderToStaticMarkup(
      <FirstRunSkipDialog isOpen={true} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(dialogHtml).toContain('Пропустить шаг «Источник»?');
    expect(dialogHtml).toContain('Вернуться');
    expect(dialogHtml).toContain('Пропустить');

    const toastHtml = renderToStaticMarkup(
      <FirstRunSkippedToast isVisible={true} onUndo={() => {}} />,
    );
    expect(toastHtml).toContain('Источник пропущен. Подключить можно в «Аккаунт → Подключения».');
    expect(toastHtml).toContain('Вернуть');
  });

  it('renders FirstRunWizard on mobile with consultant modal when requested', () => {
    const html = renderToStaticMarkup(
      <FirstRunWizard initialStep="source" isMobile={true} />,
    );
    expect(html).toContain('Шаг 2 из 3');
    expect(html).toContain('Файл резюме');
    expect(html).toContain('Рассказать консультанту');
  });
});
