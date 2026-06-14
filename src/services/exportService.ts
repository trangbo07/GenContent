import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from 'docx';
import PDFDocument from 'pdfkit';

// Strip all ## SECTION X: headers and --- dividers — return only broadcast prose
function extractCleanLines(content: string): string[] {
  const raw = content.split('\n');
  const cleaned: string[] = [];
  let blankRun = 0;

  for (const line of raw) {
    const trimmed = line.trim();

    // Drop section headers and horizontal rules
    if (/^#{1,3}\s*SECTION\s*\d+/i.test(trimmed)) continue;
    if (/^#{1,3}\s/.test(trimmed)) continue;
    if (trimmed === '---') continue;

    if (trimmed === '') {
      blankRun++;
      if (blankRun <= 1) cleaned.push('');
    } else {
      blankRun = 0;
      cleaned.push(line);
    }
  }

  // Trim leading/trailing blanks
  while (cleaned.length && cleaned[0] === '') cleaned.shift();
  while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop();

  return cleaned;
}

// ── DOCX ────────────────────────────────────────────────────────────────────
export async function exportToDocx(title: string, content: string): Promise<Buffer> {
  const lines = extractCleanLines(content);

  const children: Paragraph[] = [
    // Title
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 36, color: '1a1a1a' })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 8 },
      },
      spacing: { after: 400 },
    }),
  ];

  for (const line of lines) {
    if (line === '') {
      children.push(new Paragraph({ spacing: { after: 80 } }));
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 24, font: 'Georgia' })],
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 160, line: 360 },
        }),
      );
    }
  }

  const doc = new Document({
    creator: 'World Cup 2026 Script Generator',
    title,
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, bottom: 1080, left: 1260, right: 1260 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ── PDF ──────────────────────────────────────────────────────────────────────
export async function exportToPdf(title: string, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 72, bottom: 72, left: 80, right: 80 },
      info: { Title: title, Creator: 'World Cup 2026 Script Generator' },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Title
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(title, { align: 'center' });

    doc.moveDown(0.4);

    // Divider line under title
    const x = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.moveTo(x, doc.y).lineTo(x + w, doc.y).strokeColor('#cccccc').lineWidth(1).stroke();

    doc.moveDown(1.2);

    // Body
    const lines = extractCleanLines(content);
    doc.font('Helvetica').fontSize(11);

    for (const line of lines) {
      if (line === '') {
        doc.moveDown(0.6);
      } else {
        doc.text(line, { align: 'justify', lineGap: 3 });
      }
    }

    doc.end();
  });
}
