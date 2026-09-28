import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopOutreachModal } from './DesktopOutreachModal';
import * as desktopBridge from '../../services/desktop/desktopBridge';
import { resetOutreachQuota } from '../../services/desktop/desktopOutreachService';
import { buildSyntheticProfiles } from '../../services/desktop/desktopOutreachService';
import { clearOutreachStore } from './outreachTrackingStore';

describe('DesktopOutreachModal', () => {
  const sampleVacancy = {
    id: 'vac-101',
    title: 'Staff Frontend Engineer',
    company: 'FinTech Group',
    location: 'Москва',
    isRemote: true,
  };

  beforeEach(() => {
    resetOutreachQuota('2026-09-17');
    clearOutreachStore();
    vi.restoreAllMocks();
  });

  it('returns null when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <DesktopOutreachModal
        isOpen={false}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
      />,
    );
    expect(html).toBe('');
  });

  it('renders modal dialog with header, company, and web mode session badge', () => {
    vi.spyOn(desktopBridge, 'isTauriEnvironment').mockReturnValue(false);

    const html = renderToStaticMarkup(
      <DesktopOutreachModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialProfiles={buildSyntheticProfiles('FinTech Group')}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('FinTech Group');
    expect(html).toContain('Staff Frontend Engineer');
    expect(html).toContain('Только копирование (веб)');
  });

  it('renders desktop session badge when in Tauri environment', () => {
    vi.spyOn(desktopBridge, 'isTauriEnvironment').mockReturnValue(true);

    const html = renderToStaticMarkup(
      <DesktopOutreachModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
      />,
    );

    expect(html).toContain('Отправка из приложения');
  });

  it('renders quota tracker banner with daily limit information', () => {
    const html = renderToStaticMarkup(
      <DesktopOutreachModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
      />,
    );

    expect(html).toContain('из <strong>15</strong> инвайтов');
    expect(html).toContain('Осталось 15');
    expect(html).toContain('Защита от блокировки площадкой');
  });

  it('renders decision makers list with connection degree and mutual contacts badges', () => {
    const html = renderToStaticMarkup(
      <DesktopOutreachModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialProfiles={buildSyntheticProfiles('FinTech Group')}
      />,
    );

    expect(html).toContain('Анна Воронова');
    expect(html).toContain('Михаил Соколов');
    expect(html).toContain('1-й круг');
    expect(html).toContain('2-й круг');
    expect(html).toContain('общих контактов');
  });

  it('renders connection note input with character counter', () => {
    const html = renderToStaticMarkup(
      <DesktopOutreachModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialNote="Здравствуйте, Анна! Заинтересовала позиция в FinTech Group."
      />,
    );

    expect(html).toContain('Заметка к запросу в контакты');
    expect(html).toContain('Здравствуйте, Анна!');
    expect(html).toContain('из 300');
  });

  it('tells web users to copy and paste, without internal ADR numbers (B236)', () => {
    vi.spyOn(desktopBridge, 'isTauriEnvironment').mockReturnValue(false);

    const html = renderToStaticMarkup(
      <DesktopOutreachModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
      />,
    );

    expect(html).not.toContain('ADR-009');
    expect(html).toContain('В веб-версии отправить нельзя');
    expect(html).toContain('Скопировать текст');
  });

  it('contains zero emoji and zero forbidden word in markup', () => {
    const html = renderToStaticMarkup(
      <DesktopOutreachModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
      />,
    );

    // Zero emoji
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);

    // Zero forbidden word
    const forbiddenWord = ['\u0434', '\u043E', '\u0441', '\u044C', '\u0435'].join('');
    expect(html).not.toMatch(new RegExp(forbiddenWord, 'i'));
  });
});

describe('DesktopOutreachModal — нет контактов (B297)', () => {
  const sampleVacancy = {
    id: 'vac-202',
    title: 'Head of AI & KI-Manager',
    company: 'DataSmart Point',
    location: 'Germany',
    isRemote: true,
  };

  function render() {
    return renderToStaticMarkup(
      <DesktopOutreachModal isOpen onClose={vi.fn()} vacancy={sampleVacancy} />,
    );
  }

  it('не рисует вкладки категорий и пустой список, а говорит прямо', () => {
    const html = render();
    expect(html).not.toContain('Категории контактов');
    expect(html).not.toContain('Список контактов');
    expect(html).toContain('В этой компании мы никого не знаем');
  });

  it('оставляет черновик и копирование — человек находится кандидатом', () => {
    const html = render();
    expect(html).toContain('Заметка');
    expect(html).toContain('Скопировать');
    expect(html).toContain('Head of AI');
  });

  it('рисует категории и список, когда контакты есть', () => {
    const html = renderToStaticMarkup(
      <DesktopOutreachModal
        isOpen
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialProfiles={buildSyntheticProfiles('DataSmart Point')}
      />,
    );
    expect(html).toContain('Категории контактов');
    expect(html).toContain('Список контактов');
    expect(html).not.toContain('В этой компании мы никого не знаем');
  });
});
