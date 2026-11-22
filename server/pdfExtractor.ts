import { GEMINI_MODEL, getGeminiClient, withRetry } from './geminiClient.ts';

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface PdfExtractionResult {
  pageCount: number;
  pages: PageText[];
  combinedText: string;
  extractionMethod: 'text' | 'ocr' | 'hybrid';
  extractionNotes: string | null;
}

const MAX_COMBINED_CHARS = 120_000;
const MAX_OCR_BYTES = 18 * 1024 * 1024; // 18 MB inline PDF limit

export function isValidPdfBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 5) return false;
  // Standard PDF files begin with %PDF- (occasionally preceded by whitespace/BOM within first 1024 bytes)
  const headerSlice = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  return headerSlice.includes('%PDF-');
}

interface TextItemLike {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

function reconstructPageLines(items: TextItemLike[]): string {
  const lines: string[] = [];
  let currentLine = '';
  let lastY: number | null = null;

  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str : '';
    if (!str && !item.hasEOL) continue;

    const y = Array.isArray(item.transform) && item.transform.length >= 6 ? item.transform[5] : null;
    const lineBreakByY = lastY !== null && y !== null && Math.abs(y - lastY) > 4;

    if (lineBreakByY && currentLine.trim().length > 0) {
      lines.push(currentLine.trim());
      currentLine = '';
    }

    if (str) {
      if (currentLine.length > 0 && !currentLine.endsWith(' ') && !str.startsWith(' ')) {
        currentLine += ' ';
      }
      currentLine += str;
    }

    if (item.hasEOL && currentLine.trim().length > 0) {
      lines.push(currentLine.trim());
      currentLine = '';
      lastY = null;
    } else if (y !== null) {
      lastY = y;
    }
  }

  if (currentLine.trim().length > 0) {
    lines.push(currentLine.trim());
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function runGeminiPdfOcr(buffer: Buffer, knownPageCount: number): Promise<PdfExtractionResult> {
  if (buffer.length > MAX_OCR_BYTES) {
    throw new Error(
      'This scanned PDF exceeds the 18 MB limit for optical character recognition (OCR). Please compress or split the document and retry.'
    );
  }

  const ai = getGeminiClient();
  const base64Pdf = buffer.toString('base64');

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: base64Pdf,
            },
          },
          {
            text:
              'Perform complete, high-accuracy OCR and table/chart transcription on this PDF document. ' +
              'Output EVERY page marked clearly as "--- PAGE N ---" (starting at 1). ' +
              'Preserve all exact wording, numbers, percentages, currency amounts, dates, table cells, footnotes, and chart labels verbatim. ' +
              'Do not summarize, correct, or omit figures.',
          },
        ],
      },
      config: {
        systemInstruction:
          'You are a precision document OCR engine. Transcribe text, tables, and chart figures faithfully with explicit "--- PAGE N ---" markers.',
      },
    })
  );

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error(
      'OCR could not read any text from this PDF. Ensure the pages are legible and not blank or encrypted.'
    );
  }

  const pages: PageText[] = [];
  const pageRegex = /---\s*PAGE\s+(\d+)\s*---/gi;
  const matches = [...rawText.matchAll(pageRegex)];

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const pageNum = Number(matches[i][1]) || i + 1;
      const start = (matches[i].index ?? 0) + matches[i][0].length;
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? rawText.length) : rawText.length;
      const pageBody = rawText.slice(start, end).trim();
      if (pageBody) {
        pages.push({ pageNumber: pageNum, text: pageBody });
      }
    }
  } else {
    pages.push({ pageNumber: 1, text: rawText });
  }

  const effectivePages = pages.length > 0 ? pages : [{ pageNumber: 1, text: rawText }];
  const combined = formatCombinedPages(effectivePages);

  return {
    pageCount: Math.max(knownPageCount, effectivePages.length),
    pages: effectivePages,
    combinedText: combined.text,
    extractionMethod: 'ocr',
    extractionNotes: combined.truncated
      ? 'Scanned PDF processed via AI OCR. Document exceeded length cap; the first 120,000 characters were analyzed.'
      : 'Scanned or image-based PDF detected. Full text, tables, and figures were extracted using AI OCR.',
  };
}

function formatCombinedPages(pages: PageText[]): { text: string; truncated: boolean } {
  let result = '';
  let truncated = false;

  for (const page of pages) {
    const block = `[Page ${page.pageNumber}]\n${page.text}\n\n`;
    if (result.length + block.length > MAX_COMBINED_CHARS) {
      const remaining = MAX_COMBINED_CHARS - result.length;
      if (remaining > 200) {
        result += block.slice(0, remaining);
      }
      truncated = true;
      break;
    }
    result += block;
  }

  return { text: result.trim(), truncated };
}

export async function extractPdfContent(buffer: Buffer): Promise<PdfExtractionResult> {
  if (!isValidPdfBuffer(buffer)) {
    throw new Error('The uploaded file is not a valid PDF document. Please upload a standard .pdf file.');
  }

  let pageCount = 0;
  const pages: PageText[] = [];
  let pdfJsError: string | null = null;

  try {
    // Use pdfjs-dist legacy ESM build for pure Node.js compatibility without native canvas
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });

    const pdfDoc = await loadingTask.promise;
    pageCount = pdfDoc.numPages;

    if (pageCount === 0) {
      throw new Error('This PDF contains zero pages.');
    }

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = reconstructPageLines(textContent.items as TextItemLike[]);
      pages.push({ pageNumber: pageNum, text: pageText });
    }

    await loadingTask.destroy();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypted')) {
      throw new Error('This PDF is password-protected or encrypted. Please upload an unlocked PDF.');
    }
    pdfJsError = msg;
  }

  const totalChars = pages.reduce((sum, p) => sum + p.text.replace(/\s+/g, '').length, 0);
  const avgCharsPerPage = pageCount > 0 ? totalChars / pageCount : 0;

  // Trigger native Gemini PDF OCR if pdfjs failed, text layer is missing, or document looks scanned
  if (pdfJsError || totalChars < 120 || avgCharsPerPage < 65) {
    return runGeminiPdfOcr(buffer, pageCount || 1);
  }

  const nonEmptyPages = pages.filter((p) => p.text.trim().length > 0);
  const emptyPageCount = pageCount - nonEmptyPages.length;
  const combined = formatCombinedPages(nonEmptyPages);

  const notes: string[] = [];
  if (emptyPageCount > 0) {
    notes.push(`${emptyPageCount} page(s) contained no selectable text layer (possibly cover art or images).`);
  }
  if (combined.truncated) {
    notes.push('Large document: analyzed the first 120,000 characters across pages.');
  }

  return {
    pageCount,
    pages: nonEmptyPages,
    combinedText: combined.text,
    extractionMethod: 'text',
    extractionNotes: notes.length > 0 ? notes.join(' ') : null,
  };
}
