import { useState } from 'react';
import { getResumeStudio } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import { Icon, useToast } from '../kit';
import { roleResumeFromProfile } from './roleResume';
import { ROLE_RESUME_FAILED, roleResumePdf } from './roleResumeApi';

type Action = 'open' | 'download';

/** Свежий профиль → PDF: «Открыть» и «Скачать» дают тот же файл, что увидит работодатель. */
async function buildPdf(title: string): Promise<{ readonly blob: Blob; readonly name: string }> {
  forgetSharedRead('resume');
  const resume = roleResumeFromProfile(await getResumeStudio(), title);
  if (!resume) throw new Error(ROLE_RESUME_FAILED);
  const name = [resume.fullName, title].filter(Boolean).join(' — ') || 'Резюме';
  return { blob: await roleResumePdf(resume), name: `${name}.pdf` };
}

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * s01 по макету: стрелка открывает PDF резюме под роль в новой вкладке (там же печать),
 * загрузка скачивает его. Вкладка открывается сразу по нажатию: после ожидания браузер
 * её бы не открыл. Не открылась — файл скачивается.
 */
export function RoleResumeActions({ title }: { readonly title: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState<Action | null>(null);

  async function run(action: Action) {
    const tab = action === 'open' ? window.open('', '_blank') : null;
    setBusy(action);
    try {
      const { blob, name } = await buildPdf(title);
      if (tab) tab.location.href = URL.createObjectURL(blob);
      else saveFile(blob, name);
    } catch (reason) {
      tab?.close();
      toast.show({ text: reason instanceof Error ? reason.message : ROLE_RESUME_FAILED });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        className="icon-btn"
        type="button"
        aria-label={`Открыть резюме «${title}»`}
        aria-busy={busy === 'open'}
        disabled={busy !== null}
        onClick={() => void run('open')}
      >
        <Icon name="arrow" />
      </button>
      <button
        className="icon-btn"
        type="button"
        aria-label={`Скачать резюме «${title}»`}
        aria-busy={busy === 'download'}
        disabled={busy !== null}
        onClick={() => void run('download')}
      >
        <Icon name="download" />
      </button>
    </>
  );
}
