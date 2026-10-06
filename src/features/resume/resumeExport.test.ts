import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTargetedResumeSlice } from '../../../server/domain/resumeStudio';
import type { ResumeDocument } from './resumeTypes';
import {
  exportResumeAsJson,
  exportResumeAsPlainText,
  formatTargetedResumeAsAtsText,
  resumeExportFileName,
  resumeTargetedExportFileName,
  saveResumeAsPdf,
  triggerFileDownload,
  triggerResumePrint,
} from './resumeExport';

const desktop = vi.hoisted(() => ({ active: false }));
const saveDialog = vi.hoisted(() => vi.fn());
const writeTextFile = vi.hoisted(() => vi.fn());
const invokeDesktop = vi.hoisted(() => vi.fn());
vi.mock('../../services/desktop/desktopBridge', () => ({
  isTauriEnvironment: () => desktop.active,
  invokeDesktopCommand: invokeDesktop,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: saveDialog }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  desktop.active = false;
});

function minimalDocument(overrides?: Partial<ResumeDocument>): ResumeDocument {
  return {
    kind: 'master',
    targetRole: null,
    contact: {
      fullName: null,
      email: null,
      phone: null,
      telegram: null,
      location: null,
      links: [],
    },
    about: null,
    photoUrl: null,
    experience: [],
    skills: [],
    education: [],
    courses: [],
    tests: [],
    recommendations: [],
    languages: [],
    additional: null,
    unknowns: [],
    conventions: {
      country: null,
      packVersion: null,
      reverseChronological: true,
      maxPages: null,
      recommendedBulletsPerRole: null,
      photo: 'omitted',
      discriminatoryPii: 'omitted',
    },
    length: { lines: 0, pages: 1, linesPerPage: 45 },
    ...overrides,
  };
}

describe('resumeExport', () => {
  it('formats an empty document into minimal safe text without crashing', () => {
    const doc = minimalDocument();
    const text = exportResumeAsPlainText(doc);
    expect(text).toBe('');
  });

  it('generates a clean ATS text representation with contacts and sections', () => {
    const doc = minimalDocument({
      contact: {
        fullName: 'Алексей Смирнов',
        email: 'alex@example.com',
        phone: '+7 999 123-45-67',
        telegram: '@alexsmirnov',
        location: 'Москва',
        links: [],
      },
      about: 'Опытный технический лидер с фокусом на масштабирование инфраструктуры.',
      targetRole: 'Head of Infrastructure / Lead DevOps',
      experience: [
        {
          id: 'exp-1',
          title: {
            value: 'Lead DevOps Engineer',
            memoryId: 'm-6',
            sourceMessageIds: [],
            reviewFlags: [],
          },
          employer: { value: 'TechCorp', memoryId: 'm-7', sourceMessageIds: [], reviewFlags: [] },
          location: { value: 'Москва', memoryId: 'm-8', sourceMessageIds: [], reviewFlags: [] },
          startDate: { value: '2021', memoryId: 'm-9', sourceMessageIds: [], reviewFlags: [] },
          endDate: null,
          current: { value: true, memoryId: 'm-10', sourceMessageIds: [], reviewFlags: [] },
          bullets: [
            {
              value: 'Сократил время деплоя с 45 до 8 минут.',
              memoryId: 'm-11',
              sourceMessageIds: [],
              reviewFlags: [],
            },
            {
              value: 'Внедрил Kubernetes кластер на 120 нод.',
              memoryId: 'm-12',
              sourceMessageIds: [],
              reviewFlags: [],
            },
          ],
        },
      ],
      education: [
        {
          id: 'edu-1',
          institution: {
            value: 'МГТУ им. Баумана',
            memoryId: 'm-13',
            sourceMessageIds: [],
            reviewFlags: [],
          },
          qualification: {
            value: 'Информатика и вычислительная техника',
            memoryId: 'm-14',
            sourceMessageIds: [],
            reviewFlags: [],
          },
          startDate: { value: '2012', memoryId: 'm-15', sourceMessageIds: [], reviewFlags: [] },
          endDate: { value: '2018', memoryId: 'm-16', sourceMessageIds: [], reviewFlags: [] },
        },
      ],
      skills: [
        { id: 's-1', name: 'Kubernetes' },
        { id: 's-2', name: 'Terraform' },
        { id: 's-3', name: 'Go' },
      ],
      languages: [
        {
          id: 'lang-1',
          name: { value: 'Английский', memoryId: 'm-17', sourceMessageIds: [], reviewFlags: [] },
          cefr: { value: 'C1', memoryId: 'm-18', sourceMessageIds: [], reviewFlags: [] },
        },
      ],
    });

    const text = exportResumeAsPlainText(doc);

    expect(text).toContain('АЛЕКСЕЙ СМИРНОВ');
    expect(text).toContain('Head of Infrastructure / Lead DevOps');
    expect(text).toContain('alex@example.com');
    expect(text).toContain('+7 999 123-45-67');
    expect(text).toContain('@alexsmirnov');
    expect(text).toContain('Москва');
    expect(text).toContain('ОБО МНЕ');
    expect(text).toContain('Опытный технический лидер');
    expect(text).toContain('ОПЫТ РАБОТЫ');
    expect(text).toContain('Lead DevOps Engineer — TechCorp');
    expect(text).toContain('2021 — настоящее время');
    expect(text).toContain('- Сократил время деплоя с 45 до 8 минут.');
    expect(text).toContain('- Внедрил Kubernetes кластер на 120 нод.');
    expect(text).toContain('ОБРАЗОВАНИЕ');
    expect(text).toContain('МГТУ им. Баумана');
    expect(text).toContain('Информатика и вычислительная техника');
    expect(text).toContain('НАВЫКИ');
    expect(text).toContain('Kubernetes, Terraform, Go');
    expect(text).toContain('ЯЗЫКИ');
    expect(text).toContain('Английский (C1)');
  });

  it('exports structured JSON with indentation', () => {
    const doc = minimalDocument({ targetRole: 'Backend Engineer' });
    const json = exportResumeAsJson(doc);
    const parsed = JSON.parse(json);
    expect(parsed.targetRole).toBe('Backend Engineer');
    expect(parsed.kind).toBe('master');
  });

  it('builds a safe file name slug with variant and name', () => {
    const doc = minimalDocument({
      contact: {
        fullName: 'Иван Иванов',
        email: null,
        phone: null,
        telegram: null,
        location: null,
        links: [],
      },
      kind: 'country-role',
    });

    const txtName = resumeExportFileName(doc, 'txt');
    expect(txtName).toBe('resume-germany-ivan-ivanov.txt');

    const jsonName = resumeExportFileName(doc, 'json');
    expect(jsonName).toBe('resume-germany-ivan-ivanov.json');
  });

  it('exports the targeted slice and reports gaps without presenting them as candidate facts', () => {
    const doc = minimalDocument({
      contact: {
        fullName: 'Анна Пример',
        email: 'anna@example.test',
        phone: null,
        telegram: null,
        location: 'Москва',
        links: [],
      },
      targetRole: 'Инженер платформы',
      experience: [
        {
          id: 'platform',
          title: { value: 'Инженер платформы', memoryId: 'role', sourceMessageIds: [], reviewFlags: [] },
          employer: { value: 'Example Cloud', memoryId: 'role', sourceMessageIds: [], reviewFlags: [] },
          location: null,
          startDate: { value: '2022', memoryId: 'role', sourceMessageIds: [], reviewFlags: [] },
          endDate: null,
          current: { value: true, memoryId: 'role', sourceMessageIds: [], reviewFlags: [] },
          bullets: [
            { value: 'Автоматизировала развёртывание Kubernetes-сервисов.', memoryId: 'k8s', sourceMessageIds: [], reviewFlags: [] },
          ],
        },
        {
          id: 'sales',
          title: { value: 'Менеджер продаж', memoryId: 'sales-role', sourceMessageIds: [], reviewFlags: [] },
          employer: { value: 'Example Retail', memoryId: 'sales-role', sourceMessageIds: [], reviewFlags: [] },
          location: null,
          startDate: { value: '2019', memoryId: 'sales-role', sourceMessageIds: [], reviewFlags: [] },
          endDate: { value: '2021', memoryId: 'sales-role', sourceMessageIds: [], reviewFlags: [] },
          current: { value: false, memoryId: 'sales-role', sourceMessageIds: [], reviewFlags: [] },
          bullets: [
            { value: 'Вела переговоры с партнёрами.', memoryId: 'sales-work', sourceMessageIds: [], reviewFlags: [] },
          ],
        },
      ],
      skills: [{ id: 'k8s', name: 'Kubernetes' }],
    });
    const slice = buildTargetedResumeSlice(doc, {
      title: 'Инженер платформы',
      requirements: ['Kubernetes', 'GraphQL'],
    });

    const text = formatTargetedResumeAsAtsText(slice);

    expect(text).toContain('Автоматизировала развёртывание Kubernetes-сервисов.');
    expect(text).toContain('Менеджер продаж | Example Retail');
    expect(text).not.toContain('Вела переговоры с партнёрами.');
    expect(text).toContain('GraphQL');
    expect(text).toContain('GraphQL - не найдено в мастер-резюме');
    expect(resumeTargetedExportFileName(doc, 'pdf')).toBe('resume-targeted-anna-primer.pdf');
  });

  it('writes a Tauri export to the path chosen in the save dialog', async () => {
    desktop.active = true;
    saveDialog.mockResolvedValue('/Users/test/Downloads/profile.json');
    writeTextFile.mockResolvedValue(undefined);

    const path = await triggerFileDownload('profile.json', '{"name":"Ada"}', 'application/json');

    expect(path).toBe('/Users/test/Downloads/profile.json');
    expect(writeTextFile).toHaveBeenCalledWith(path, '{"name":"Ada"}');
  });

  it('does not report success when the save dialog is cancelled', async () => {
    desktop.active = true;
    saveDialog.mockResolvedValue(null);

    await expect(triggerFileDownload('profile.json', '{}', 'application/json')).resolves.toBeNull();
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it('opens the native PDF dialog with the targeted resume filename', async () => {
    desktop.active = true;
    saveDialog.mockResolvedValue('/Users/test/Downloads/resume-targeted-anna-primer.pdf');
    invokeDesktop.mockResolvedValue(true);

    await expect(saveResumeAsPdf('resume-targeted-anna-primer.pdf')).resolves.toBe(
      '/Users/test/Downloads/resume-targeted-anna-primer.pdf',
    );
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: 'resume-targeted-anna-primer.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    expect(invokeDesktop).toHaveBeenCalledWith('save_resume_pdf', {
      path: '/Users/test/Downloads/resume-targeted-anna-primer.pdf',
    });
  });

  it('keeps decision profile constraints (salary floor, cushion, citizenship) out of public resume exports', () => {
    const doc = minimalDocument({
      about: 'Senior Developer with strong architecture skills',
      skills: [{ id: 's-1', name: 'TypeScript' }],
    });
    const json = exportResumeAsJson(doc);
    const text = exportResumeAsPlainText(doc);

    // Third-party public resume exports must not include confidential decision parameters
    expect(json).not.toContain('salaryFloor');
    expect(json).not.toContain('cushionMonths');
    expect(json).not.toContain('taxStatus');
    expect(json).not.toContain('familyNotes');

    expect(text).not.toContain('Зарплатный пол');
    expect(text).not.toContain('Финансовая подушка');
    expect(text).not.toContain('Гражданство');
    expect(text).not.toContain('Налоговый статус');
  });
});

// .app 05.10: «Отмена» в окне печати показывала «Печать недоступна — сохраните PDF».
describe('triggerResumePrint в .app', () => {
  afterEach(() => {
    desktop.active = false;
  });

  it('отмена печати не считается сбоем', async () => {
    desktop.active = true;
    invokeDesktop.mockResolvedValueOnce(false);
    await expect(triggerResumePrint()).resolves.toBe(false);
  });

  it('сбой нативной печати поднимает ошибку', async () => {
    desktop.active = true;
    invokeDesktop.mockRejectedValueOnce(new Error('print_resume: main webview unavailable'));
    await expect(triggerResumePrint()).rejects.toThrow();
  });
});
