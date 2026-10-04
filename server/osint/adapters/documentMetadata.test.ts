import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { documentMetadataAdapter } from './documentMetadata';

function createMockDocx(options: {
  creator?: string;
  company?: string;
  application?: string;
  lastModifiedBy?: string;
  revision?: string;
  comments?: Array<{ author: string; date?: string; initials?: string }>;
  filePath?: string;
}): Buffer {
  const files: Record<string, Uint8Array> = {};

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/">
  ${options.creator ? `<dc:creator>${options.creator}</dc:creator>` : ''}
  ${options.lastModifiedBy ? `<cp:lastModifiedBy>${options.lastModifiedBy}</cp:lastModifiedBy>` : ''}
  ${options.revision ? `<cp:revision>${options.revision}</cp:revision>` : ''}
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T10:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-02T12:00:00Z</dcterms:modified>
</cp:coreProperties>`;
  files['docProps/core.xml'] = strToU8(coreXml);

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  ${options.company ? `<Company>${options.company}</Company>` : ''}
  ${options.application ? `<Application>${options.application}</Application>` : ''}
  ${options.filePath ? `<FilePath>${options.filePath}</FilePath>` : ''}
</Properties>`;
  files['docProps/app.xml'] = strToU8(appXml);

  if (options.comments && options.comments.length > 0) {
    const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${options.comments
    .map(
      (c, i) =>
        `<w:comment w:id="${i}" w:author="${c.author}" w:date="${c.date ?? '2026-01-03T10:00:00Z'}" w:initials="${c.initials ?? 'AB'}"><w:p><w:r><w:t>Review note</w:t></w:r></w:p></w:comment>`,
    )
    .join('')}
</w:comments>`;
    files['word/comments.xml'] = strToU8(commentsXml);
  }

  return Buffer.from(zipSync(files));
}

function createMockPng(texts: Record<string, string>): Buffer {
  const chunks: Buffer[] = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ];
  for (const [key, value] of Object.entries(texts)) {
    const data = Buffer.concat([
      Buffer.from(key, 'latin1'),
      Buffer.from([0]),
      Buffer.from(value, 'latin1'),
    ]);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from('tEXt', 'ascii');
    const crcBuf = Buffer.alloc(4);
    chunks.push(lenBuf, typeBuf, data, crcBuf);
  }
  return Buffer.concat(chunks);
}

function createMockJpegWithGps(options: {
  artist: string;
  software: string;
  latitude: { deg: number; min: number; sec: number; ref: 'N' | 'S' };
  longitude: { deg: number; min: number; sec: number; ref: 'E' | 'W' };
  altitude?: number;
}): Buffer {
  const tiff = Buffer.alloc(256);
  tiff.write('II', 0);
  tiff.writeUInt16LE(0x002a, 2);
  tiff.writeUInt32LE(8, 4);

  // IFD0 at offset 8: 3 entries
  tiff.writeUInt16LE(3, 8);
  tiff.writeUInt16LE(0x013b, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(options.artist.length + 1, 14);
  tiff.writeUInt32LE(150, 18);
  tiff.write(`${options.artist}\0`, 150, 'latin1');

  tiff.writeUInt16LE(0x0131, 22);
  tiff.writeUInt16LE(2, 24);
  tiff.writeUInt32LE(options.software.length + 1, 26);
  tiff.writeUInt32LE(170, 30);
  tiff.write(`${options.software}\0`, 170, 'latin1');

  tiff.writeUInt16LE(0x8825, 34);
  tiff.writeUInt16LE(4, 36);
  tiff.writeUInt32LE(1, 38);
  tiff.writeUInt32LE(50, 42);
  tiff.writeUInt32LE(0, 46);

  // GPS IFD at offset 50: 5 entries
  tiff.writeUInt16LE(5, 50);
  tiff.writeUInt16LE(1, 52);
  tiff.writeUInt16LE(2, 54);
  tiff.writeUInt32LE(2, 56);
  tiff.writeUInt32LE(options.latitude.ref.charCodeAt(0), 60);

  tiff.writeUInt16LE(2, 64);
  tiff.writeUInt16LE(5, 66);
  tiff.writeUInt32LE(3, 68);
  tiff.writeUInt32LE(190, 72);
  tiff.writeUInt32LE(options.latitude.deg, 190);
  tiff.writeUInt32LE(1, 194);
  tiff.writeUInt32LE(options.latitude.min, 198);
  tiff.writeUInt32LE(1, 202);
  tiff.writeUInt32LE(options.latitude.sec, 206);
  tiff.writeUInt32LE(1, 210);

  tiff.writeUInt16LE(3, 76);
  tiff.writeUInt16LE(2, 78);
  tiff.writeUInt32LE(2, 80);
  tiff.writeUInt32LE(options.longitude.ref.charCodeAt(0), 84);

  tiff.writeUInt16LE(4, 88);
  tiff.writeUInt16LE(5, 90);
  tiff.writeUInt32LE(3, 92);
  tiff.writeUInt32LE(214, 96);
  tiff.writeUInt32LE(options.longitude.deg, 214);
  tiff.writeUInt32LE(1, 218);
  tiff.writeUInt32LE(options.longitude.min, 222);
  tiff.writeUInt32LE(1, 226);
  tiff.writeUInt32LE(options.longitude.sec, 230);
  tiff.writeUInt32LE(1, 234);

  if (options.altitude !== undefined) {
    tiff.writeUInt16LE(6, 100);
    tiff.writeUInt16LE(5, 102);
    tiff.writeUInt32LE(1, 104);
    tiff.writeUInt32LE(238, 108);
    tiff.writeUInt32LE(options.altitude, 238);
    tiff.writeUInt32LE(1, 242);
  }

  const app1Payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1Len = Buffer.alloc(2);
  app1Len.writeUInt16BE(app1Payload.length + 2, 0);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]),
    app1Len,
    app1Payload,
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe('documentMetadataAdapter', () => {
  it('extracts PDF metadata with author, company, software, and file paths', async () => {
    const pdfContent = `%PDF-1.4
1 0 obj
<<
  /Author (Ivan Ivanov)
  /Company (Acme Corporation)
  /Creator (Microsoft Word)
  /Producer (macOS Version 14.4.1 Quartz PDFContext)
>>
endobj
% Internal storage path: /Users/ivan/Projects/secret_proposal.docx
trailer
<< /Info 1 0 R >>
%%EOF`;

    const findings = await documentMetadataAdapter.run({
      buffer: Buffer.from(pdfContent, 'latin1'),
      filename: 'resume.pdf',
    });

    expect(findings.length).toBeGreaterThanOrEqual(4);

    const authorFinding = findings.find((f) => f.title.includes('автор'));
    expect(authorFinding).toBeDefined();
    expect(authorFinding?.detail).toContain('Ivan Ivanov');
    expect(authorFinding?.detail).toContain('Риск: средний.');
    expect(authorFinding?.match).toBe('likely_self');

    const companyFinding = findings.find((f) => f.title.includes('организация/компания'));
    expect(companyFinding).toBeDefined();
    expect(companyFinding?.detail).toContain('Acme Corporation');
    expect(companyFinding?.detail).toContain('Риск: высокий.');

    const softwareFinding = findings.find((f) => f.title.includes('программное обеспечение'));
    expect(softwareFinding).toBeDefined();
    expect(softwareFinding?.detail).toContain('Риск: низкий.');

    const pathFinding = findings.find((f) => f.title.includes('локальный путь'));
    expect(pathFinding).toBeDefined();
    expect(pathFinding?.detail).toContain('/Users/ivan/Projects/secret_proposal.docx');
    expect(pathFinding?.detail).toContain('Риск: средний.');
  });

  it('extracts XMP metadata from PDF documents', async () => {
    const pdfXmp = `%PDF-1.4
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <dc:creator><rdf:Seq><rdf:li>Elena Petrova</rdf:li></rdf:Seq></dc:creator>
  <pdfx:Company>FinTech Global</pdfx:Company>
  <xmp:CreatorTool>Adobe InDesign 2024</xmp:CreatorTool>
</rdf:RDF>
</x:xmpmeta>
%%EOF`;

    const findings = await documentMetadataAdapter.run({
      buffer: Buffer.from(pdfXmp, 'utf-8'),
      filename: 'report.pdf',
    });

    const authorFinding = findings.find((f) => f.title.includes('автор'));
    expect(authorFinding?.detail).toContain('Elena Petrova');

    const companyFinding = findings.find((f) => f.title.includes('организация/компания'));
    expect(companyFinding?.detail).toContain('FinTech Global');
    expect(companyFinding?.detail).toContain('Риск: высокий.');

    const softwareFinding = findings.find((f) => f.title.includes('программное обеспечение'));
    expect(softwareFinding?.detail).toContain('Adobe InDesign 2024');
    expect(softwareFinding?.detail).toContain('Риск: низкий.');
  });

  it('extracts DOCX metadata, comments reviewers, edit history, and company', async () => {
    const docxBuf = createMockDocx({
      creator: 'Sergey Sidorov',
      company: 'OpenQareer LLC',
      application: 'Microsoft Office Word 16.0',
      lastModifiedBy: 'Dmitry Editor',
      revision: '4',
      comments: [{ author: 'Anna Reviewer', initials: 'AR', date: '2026-03-01T15:00:00Z' }],
      filePath: 'C:\\Users\\admin\\SecretStrategy.docx',
    });

    const findings = await documentMetadataAdapter.run({
      buffer: docxBuf,
      filename: 'strategy.docx',
    });

    const authorFinding = findings.find((f) => f.title.includes('автор'));
    expect(authorFinding).toBeDefined();
    expect(authorFinding?.detail).toContain('Sergey Sidorov');
    expect(authorFinding?.detail).toContain('Риск: средний.');

    const companyFinding = findings.find((f) => f.title.includes('организация/компания'));
    expect(companyFinding).toBeDefined();
    expect(companyFinding?.detail).toContain('OpenQareer LLC');
    expect(companyFinding?.detail).toContain('Риск: высокий.');

    const reviewerFinding = findings.find((f) => f.title.includes('рецензент'));
    expect(reviewerFinding).toBeDefined();
    expect(reviewerFinding?.detail).toContain('Anna Reviewer');
    expect(reviewerFinding?.detail).toContain('(инициалы: AR)');
    expect(reviewerFinding?.detail).toContain('Риск: средний.');

    const historyFinding = findings.find((f) => f.title.includes('редакция документа'));
    expect(historyFinding).toBeDefined();
    expect(historyFinding?.detail).toContain('Dmitry Editor');
    expect(historyFinding?.detail).toContain('ревизия: 4');
    expect(historyFinding?.detail).toContain('Риск: средний.');

    const pathFinding = findings.find((f) => f.title.includes('локальный путь'));
    expect(pathFinding).toBeDefined();
    expect(pathFinding?.detail).toContain('C:\\Users\\admin\\SecretStrategy.docx');
  });

  it('extracts JPEG EXIF metadata including GPS coordinates with high risk', async () => {
    const jpegBuf = createMockJpegWithGps({
      artist: 'Alice Wonder',
      software: 'GIMP 2.10',
      latitude: { deg: 55, min: 45, sec: 0, ref: 'N' },
      longitude: { deg: 37, min: 36, sec: 0, ref: 'E' },
      altitude: 150,
    });

    const findings = await documentMetadataAdapter.run({
      buffer: jpegBuf,
      filename: 'photo.jpg',
    });

    const gpsFinding = findings.find((f) => f.title.includes('геолокация (GPS)'));
    expect(gpsFinding).toBeDefined();
    expect(gpsFinding?.detail).toContain('широта 55.75, долгота 37.6, высота 150м');
    expect(gpsFinding?.detail).toContain('Риск: высокий.');

    const authorFinding = findings.find((f) => f.title.includes('автор'));
    expect(authorFinding).toBeDefined();
    expect(authorFinding?.detail).toContain('Alice Wonder');
    expect(authorFinding?.detail).toContain('Риск: средний.');

    const softwareFinding = findings.find((f) => f.title.includes('программное обеспечение'));
    expect(softwareFinding).toBeDefined();
    expect(softwareFinding?.detail).toContain('GIMP 2.10');
    expect(softwareFinding?.detail).toContain('Риск: низкий.');
  });

  it('extracts PNG tEXt chunks for author and software', async () => {
    const pngBuf = createMockPng({
      Author: 'Bob Designer',
      Software: 'Figma Desktop App',
    });

    const findings = await documentMetadataAdapter.run({
      buffer: pngBuf,
      filename: 'mockup.png',
    });

    const authorFinding = findings.find((f) => f.title.includes('автор'));
    expect(authorFinding).toBeDefined();
    expect(authorFinding?.detail).toContain('Bob Designer');
    expect(authorFinding?.detail).toContain('Риск: средний.');

    const softwareFinding = findings.find((f) => f.title.includes('программное обеспечение'));
    expect(softwareFinding).toBeDefined();
    expect(softwareFinding?.detail).toContain('Figma Desktop App');
    expect(softwareFinding?.detail).toContain('Риск: низкий.');
  });

  it('handles empty buffer and unknown formats without crashing', async () => {
    const findings = await documentMetadataAdapter.run({
      buffer: Buffer.from('hello world plain text'),
      filename: 'plain.txt',
    });
    expect(findings).toEqual([]);
  });

  it('honors abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      documentMetadataAdapter.run(
        { buffer: Buffer.from('%PDF-1.4\n%%EOF'), filename: 'test.pdf' },
        controller.signal,
      ),
    ).rejects.toThrow('Операция отменена');
  });
});
