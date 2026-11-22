import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { formatGeminiError } from './server/geminiClient.ts';
import { extractPdfContent, isValidPdfBuffer } from './server/pdfExtractor.ts';
import {
  computeSummary,
  extractClaimsFromDocument,
  generateExecutiveSummary,
  verifySingleClaim,
} from './server/factChecker.ts';
import { generateSampleTestPdf } from './server/samplePdfGenerator.ts';
import type { ExtractedClaim, FactCheckReport, ProgressEvent, VerifiedClaim } from './src/types/factCheck.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const lowerName = (file.originalname || '').toLowerCase();
    const isPdfMime =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/x-pdf' ||
      file.mimetype === 'application/octet-stream';

    if (isPdfMime && lowerName.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files (.pdf) are supported.'));
    }
  },
});

function sanitizeDisplayFilename(name: string): string {
  const base = path.basename(name || 'document.pdf');
  const cleaned = base.replace(/[^\w.\-\s()]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 140) : 'document.pdf';
}

function writeSseEvent(res: Response, event: ProgressEvent): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'the-fact-check-agent',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    timestamp: new Date().toISOString(),
  });
});

// Downloadable sample PDF containing intentional accurate, outdated, false, and internal claims
app.get('/api/sample-pdf', async (_req: Request, res: Response) => {
  try {
    const pdfBuffer = await generateSampleTestPdf();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="Meridian_Clean_Energy_and_Digital_Economy_Brief_2026.pdf"'
    );
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({
      error: `Could not generate sample PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// Full-pipeline PDF analysis with real-time Server-Sent Events progress
app.post('/api/analyze', (req: Request, res: Response) => {
  upload.single('file')(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      const msg =
        uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE'
          ? 'File exceeds the 20 MB maximum upload limit. Please upload a smaller PDF.'
          : uploadErr instanceof Error
            ? uploadErr.message
            : 'Invalid file upload.';
      res.status(400).json({ error: msg });
      return;
    }

    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      res.status(400).json({ error: 'Please attach a valid PDF file to analyze.' });
      return;
    }

    if (!isValidPdfBuffer(file.buffer)) {
      res.status(400).json({
        error: 'The uploaded file does not have a valid PDF header. Please upload a real .pdf document.',
      });
      return;
    }

    if (!process.env.GEMINI_API_KEY?.trim()) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets and try again.',
      });
      return;
    }

    // Upgrade response to SSE stream once upload validation succeeds
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let clientDisconnected = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
      }
    });

    const documentName = sanitizeDisplayFilename(file.originalname);
    const todayIso = new Date().toISOString().slice(0, 10);

    try {
      // Stage 1: Upload complete
      writeSseEvent(res, {
        type: 'stage',
        stage: 'upload',
        status: 'completed',
        detail: `Received "${documentName}" (${(file.size / 1024).toFixed(1)} KB).`,
      });

      // Stage 2: Extract document text (with automatic OCR fallback)
      writeSseEvent(res, {
        type: 'stage',
        stage: 'extract',
        status: 'active',
        detail: 'Parsing PDF pages and text layers (using OCR automatically if scanned)…',
      });

      const extracted = await extractPdfContent(file.buffer);
      if (clientDisconnected) return;

      writeSseEvent(res, {
        type: 'stage',
        stage: 'extract',
        status: 'completed',
        detail:
          extracted.extractionMethod === 'ocr'
            ? `Extracted ${extracted.pageCount} scanned page(s) via optical character recognition.`
            : `Extracted selectable text from ${extracted.pageCount} page(s).`,
      });

      // Stage 3: Identify factual claims
      writeSseEvent(res, {
        type: 'stage',
        stage: 'identify',
        status: 'active',
        detail: 'Identifying statistics, dates, financial figures, and verifiable claims…',
      });

      const { claims: extractedClaims, documentPublicationDate } =
        await extractClaimsFromDocument(extracted.combinedText, extracted.pageCount);
      if (clientDisconnected) return;

      writeSseEvent(res, {
        type: 'claims_extracted',
        totalClaims: extractedClaims.length,
        pageCount: extracted.pageCount,
        extractionMethod: extracted.extractionMethod,
        extractionNotes: extracted.extractionNotes,
        claims: extractedClaims,
      });

      writeSseEvent(res, {
        type: 'stage',
        stage: 'identify',
        status: 'completed',
        detail:
          extractedClaims.length > 0
            ? `Identified ${extractedClaims.length} distinct verifiable claim(s) across ${extracted.pageCount} page(s).`
            : 'No verifiable factual claims were detected in this document.',
      });

      // Stage 4 & 5: Live web search & evidence comparison (controlled concurrency = 3)
      const verifiedClaims: VerifiedClaim[] = new Array(extractedClaims.length);

      if (extractedClaims.length > 0) {
        writeSseEvent(res, {
          type: 'stage',
          stage: 'search',
          status: 'active',
          detail: `Querying live web sources for ${extractedClaims.length} extracted claim(s)…`,
        });

        writeSseEvent(res, {
          type: 'stage',
          stage: 'compare',
          status: 'active',
          detail: 'Comparing PDF statements against authoritative web evidence…',
        });

        const concurrency = 2;
        let nextIndex = 0;
        let completedCount = 0;

        const worker = async () => {
          while (!clientDisconnected) {
            const current = nextIndex++;
            if (current >= extractedClaims.length) break;

            const claim = extractedClaims[current];
            const verified = await verifySingleClaim(claim, todayIso);
            verifiedClaims[current] = verified;
            completedCount++;

            if (!clientDisconnected) {
              writeSseEvent(res, {
                type: 'claim_verified',
                index: completedCount,
                total: extractedClaims.length,
                claim: verified,
              });
            }
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, extractedClaims.length) }, () => worker())
        );

        if (clientDisconnected) return;

        const liveCount = verifiedClaims.filter((c) => c?.liveSearchExecuted).length;

        writeSseEvent(res, {
          type: 'stage',
          stage: 'search',
          status: 'completed',
          detail:
            liveCount > 0
              ? `Completed live web verification with grounded sources on ${liveCount} of ${extractedClaims.length} claim(s).`
              : 'Live web search returned no grounded sources; claims were conservatively marked unverified.',
        });

        writeSseEvent(res, {
          type: 'stage',
          stage: 'compare',
          status: 'completed',
          detail: 'Classified all claims and computed verified corrections.',
        });
      } else {
        writeSseEvent(res, {
          type: 'stage',
          stage: 'search',
          status: 'completed',
          detail: 'Skipped live search because no factual claims were extracted.',
        });
        writeSseEvent(res, {
          type: 'stage',
          stage: 'compare',
          status: 'completed',
          detail: 'No claims required comparison.',
        });
      }

      // Stage 6: Generate executive report
      writeSseEvent(res, {
        type: 'stage',
        stage: 'report',
        status: 'active',
        detail: 'Compiling executive summary, accuracy score, and recommendations…',
      });

      const finalClaims = verifiedClaims.filter(Boolean);
      const summary = computeSummary(finalClaims);
      const { executiveSummary, recommendations } = await generateExecutiveSummary(
        documentName,
        finalClaims,
        summary
      );
      if (clientDisconnected) return;

      const liveSearchAvailable =
        finalClaims.length === 0 || finalClaims.some((c) => c.liveSearchExecuted);

      const report: FactCheckReport = {
        id: `AUD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        documentName,
        documentPublicationDate,
        fileSizeBytes: file.size,
        pageCount: extracted.pageCount,
        extractionMethod: extracted.extractionMethod,
        extractionNotes: extracted.extractionNotes,
        analysisDate: new Date().toISOString(),
        liveSearchAvailable,
        summary,
        executiveSummary,
        recommendations,
        claims: finalClaims,
      };

      writeSseEvent(res, {
        type: 'stage',
        stage: 'report',
        status: 'completed',
        detail: 'Fact-checking report ready.',
      });

      writeSseEvent(res, {
        type: 'complete',
        report,
      });

      res.end();
    } catch (error) {
      if (!clientDisconnected) {
        writeSseEvent(res, {
          type: 'error',
          message: formatGeminiError(error),
        });
        res.end();
      }
    }
  });
});

// Single-claim live re-verification endpoint (supports retrying failed searches from Claim Inspector)
app.post('/api/reverify-claim', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<ExtractedClaim>;
    if (
      !body ||
      typeof body.originalClaim !== 'string' ||
      body.originalClaim.trim().length < 4 ||
      body.originalClaim.length > 2000
    ) {
      res.status(400).json({ error: 'Invalid claim payload provided for re-verification.' });
      return;
    }

    const claimToCheck: ExtractedClaim = {
      id: typeof body.id === 'string' && body.id.trim() ? body.id.slice(0, 32) : 'CLM-01',
      pageNumber: Math.max(1, Math.round(Number(body.pageNumber) || 1)),
      additionalPages: Array.isArray(body.additionalPages)
        ? body.additionalPages.map((n) => Math.round(Number(n))).filter((n) => n >= 1)
        : undefined,
      originalClaim: body.originalClaim.trim(),
      category: body.category ?? 'General Fact',
      extractedValues: Array.isArray(body.extractedValues)
        ? body.extractedValues.filter((v): v is string => typeof v === 'string').slice(0, 12)
        : [],
      interpretation:
        typeof body.interpretation === 'string' && body.interpretation.trim()
          ? body.interpretation.trim().slice(0, 600)
          : 'Re-verification requested by analyst.',
      documentDataPeriod:
        typeof body.documentDataPeriod === 'string' ? body.documentDataPeriod.slice(0, 120) : null,
      documentPublicationDate:
        typeof body.documentPublicationDate === 'string'
          ? body.documentPublicationDate.slice(0, 80)
          : null,
    };

    const todayIso = new Date().toISOString().slice(0, 10);
    const verified = await verifySingleClaim(claimToCheck, todayIso);
    res.json({ claim: verified });
  } catch (error) {
    res.status(500).json({ error: formatGeminiError(error) });
  }
});

// Global JSON error handler for API routes
app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  res.status(500).json({ error: message });
});

async function startServer() {
  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`The Fact-Check Agent listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
