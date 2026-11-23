import { apiFetch } from '../../coach/apiClient';
import type { BuilderResume } from '../../../../shared/resumeBuilder/model';

const FAILED = 'Не удалось собрать файл. Попробуйте ещё раз.';

/** PDF резюме под роль строгим шаблоном; фото в шапке — по настройке «Фото в резюме». */
export async function roleResumePdf(resume: BuilderResume): Promise<Blob> {
  const response = await apiFetch('/api/v1/candidate/resume-builder/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'pdf', template: 'strict', resume, profilePhoto: true }),
  });
  if (!response.ok) throw new Error(FAILED);
  return response.blob();
}

export const ROLE_RESUME_FAILED = FAILED;
