import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstRunWizard, type FirstRunWizardProps } from './FirstRunWizard';
import { FirstRunSourceMenu } from './FirstRunSourceMenu';
import { FirstRunCitySheet } from './FirstRunCitySheet';
import { FirstRunSkipDialog, FirstRunSkippedToast } from './FirstRunSkipDialog';

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
    expect(html).toContain('Москва');
    expect(html).toContain('Гибрид');
    expect(html).toContain('Готов к релокации');
    expect(html).toContain('Собрать профиль');
  });

  it('renders loading and error states without invented platform progress', () => {
    expect(renderWizard({ specialState: 'skeleton' })).toContain(
      'Проверяем вход и читаем ваш профиль',
    );
    expect(renderWizard({ specialState: 'stale-loading' })).toContain(
      'Подготавливаем данные профиля',
    );
    expect(renderWizard({ specialState: 'error' })).toContain(
      'Не удалось войти: сервер не ответил. Данные не потеряны.',
    );
  });

  it('shows retry and sign-in only when handlers exist', () => {
    const error = renderWizard({ specialState: 'error', onRetry: () => undefined });
    const session = renderWizard({ specialState: 'session-expired', onSignIn: () => undefined });
    expect(error).toContain('Повторить');
    expect(session).toContain('Войти');
  });

  it('renders an honest empty-source state', () => {
    const html = renderWizard({ specialState: 'empty-sources' });
    expect(html).toContain('Источник не выбран. Можно продолжить');
    expect(html).not.toContain('подключён');
  });

  it('renders the three upload choices and a PDF file input', () => {
    const html = renderToStaticMarkup(
      <FirstRunSourceMenu isOpen onClose={() => undefined} onPickFile={() => undefined} />,
    );
    expect(html).toContain('Выбрать в «Файлах»');
    expect(html).toContain('Фото из библиотеки');
    expect(html).toContain('Сканировать документ');
    expect(html).toContain('accept="application/pdf,.pdf"');
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
    const toast = renderToStaticMarkup(
      <FirstRunSkippedToast isVisible onUndo={() => undefined} />,
    );
    expect(dialog).toContain('Пропустить шаг «Источник»?');
    expect(dialog).toContain('Вернуться');
    expect(dialog).toContain('Пропустить');
    expect(toast).toContain('Источник пропущен. Подключить можно в «Аккаунт → Подключения».');
    expect(toast).toContain('Вернуть');
  });

  it('exposes the mobile layout state supplied by the shell media query', () => {
    const html = renderWizard({ isMobile: true });
    expect(html).toContain('data-mobile="true"');
    expect(html).toContain('Шаг 2 из 3');
    expect(html).toContain('Файл резюме');
    expect(html).not.toContain('first-run-consultant-sidebar');
  });
});
