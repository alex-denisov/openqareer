/**
 * B666: фото профиля в шапке резюме (PDF и DOCX), когда «Фото в резюме» включено.
 * Встраиваются JPEG и PNG — их читают и pdfkit, и Word; другой формат (WebP из
 * LinkedIn) в файл не попадает, резюме собирается без фото.
 */
export interface ResumePhoto {
  readonly bytes: Buffer;
  readonly format: 'jpg' | 'png';
}

/** Сторона фото в шапке, pt. */
export const RESUME_PHOTO_PT = 72;
/** Зазор между фото и текстом шапки, pt. */
export const RESUME_PHOTO_GAP_PT = 12;

const FORMATS: Readonly<Record<string, ResumePhoto['format']>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export function resumePhotoOf(
  media: { readonly mime: string; readonly bytes: Buffer } | null,
): ResumePhoto | null {
  const format = media ? FORMATS[media.mime] : undefined;
  return media && format ? { bytes: media.bytes, format } : null;
}
