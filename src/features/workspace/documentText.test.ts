import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractTextDocument } from './documentText';

describe('extractTextDocument', () => {
  it('extracts readable paragraphs from a DOCX archive', async () => {
    const archive = zipSync({
      'word/document.xml': strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="word"><w:body><w:p><w:r><w:t>Руководил командой</w:t></w:r></w:p><w:p><w:r><w:t>Сократил цикл на 30%</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    const file = new File([archive], 'resume.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    await expect(extractTextDocument(file)).resolves.toBe(
      'Руководил командой\nСократил цикл на 30%',
    );
  });

  it('keeps plain-text input as candidate context', async () => {
    const file = new File(['  Product lead\nB2B launch  '], 'resume.txt', {
      type: 'text/plain',
    });

    await expect(extractTextDocument(file)).resolves.toBe('Product lead\nB2B launch');
  });
});
