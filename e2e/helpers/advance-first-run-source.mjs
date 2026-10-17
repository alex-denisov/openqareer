import { zipSync, strToU8 } from 'fflate';

/** Synthetic document, parsed through the product's actual DOCX ingestion path. */
export function firstRunResumeFile() {
  const text = 'Иван Тестовый. Разработчик. Опыт работы: TypeScript, React, SQL.';
  return {
    name: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(
      zipSync({
        'word/document.xml': strToU8(
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
        ),
      }),
    ),
  };
}

/** @param {import('@playwright/test').Page} page
 * @param {boolean} isMobile
 * @param {undefined | (() => Promise<void>)} [captureSkip]
 */
export async function advanceFirstRunSource(page, isMobile, captureSkip) {
  if (isMobile) {
    await page.getByTestId('source-skip-btn').click();
    await page.getByTestId('first-run-skip-dialog').waitFor();
    await captureSkip?.();
    await page.getByTestId('skip-confirm-btn').click();
  } else {
    await page.getByTestId('source-opt-file').click();
    await page.getByTestId('native-file-input').setInputFiles(firstRunResumeFile());
    await page
      .getByText(/Резюме прочитано/)
      .first()
      .waitFor();
    await page.getByTestId('source-opt-file').click();
  }
  await page.getByTestId('context-submit-btn').waitFor();
}
