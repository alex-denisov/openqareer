import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 40;

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

interface PdfMarkedContent {
  type: string;
}

export interface ExtractedPdfResume {
  fileName: string;
  pageCount: number;
  text: string;
}

export async function extractPdfResume(file: File): Promise<ExtractedPdfResume> {
  if (!isPdfFile(file)) {
    throw new Error('Выберите PDF-файл.');
  }

  if (file.size > MAX_PDF_BYTES) {
    throw new Error('PDF больше 20 МБ. Сохраните более компактную копию.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = workerSrc;

  const document = await getDocument({ data: bytes }).promise;
  if (document.numPages > MAX_PDF_PAGES) {
    throw new Error('В PDF больше 40 страниц. Выберите именно резюме.');
  }

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      normalizeExtractedPageText(
        content.items as Array<PdfTextItem | PdfMarkedContent>,
      ),
    );
  }

  const text = pages.filter(Boolean).join('\n\n').trim();
  if (text.length < 80) {
    throw new Error(
      'В PDF не найден читаемый текст. Возможно, это скан: используйте PDF с текстовым слоем или запасной ввод.',
    );
  }

  return {
    fileName: file.name,
    pageCount: document.numPages,
    text,
  };
}

export function normalizeExtractedPageText(
  items: Array<PdfTextItem | PdfMarkedContent>,
): string {
  return items
    .flatMap((item) =>
      'str' in item ? [`${item.str}${item.hasEOL ? '\n' : ' '}`] : [],
    )
    .join('')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}
