# The Fact-Check Agent

**Don't Just Publish. Verify.**

An AI-powered PDF fact-checking platform that extracts verifiable factual claims from uploaded PDFs, cross-checks every statement against live web sources using Google Search grounding, flags outdated or false claims with verified corrections and direct source citations, and generates downloadable audit reports (PDF, CSV, JSON).

---

## Core Capabilities

- **PDF Parsing & Automatic OCR**: Extracts page-by-page text from multi-page PDFs using `pdfjs-dist`, with automatic fallback to Gemini multimodal OCR for scanned or image-based PDFs.
- **Structured Claim Extraction**: Isolates statistics, percentages, financial figures, dates/timelines, technical specifications, market research stats, and company claims while preserving original wording and page numbers (with automatic deduplication of repeated claims).
- **Live Web Verification**: Uses Google Search grounding via the server-side `@google/genai` SDK (`gemini-4-hydrogen`) to verify claims against authoritative live web sources. Source URLs are extracted strictly from verified grounding metadata—never invented.
- **Four-Tier Classification**:
  - **Verified**: Supported by reliable, current, and relevant live evidence.
  - **Inaccurate**: Outdated statistics (explicitly showing original vs. latest data period), imprecise figures, or misleading claims, accompanied by corrected facts.
  - **False**: Directly contradicted by reliable evidence, accompanied by verified corrections.
  - **Unverified**: Insufficient public reliable sources available (e.g., proprietary internal surveys)—never misclassified as false.
- **Real-Time SSE Processing Screen**: Streams genuine server-side stage transitions and per-claim verification updates as they complete.
- **Interactive Dashboard & Claim Inspector**: Summary KPI metrics, status distribution chart, status/page/text filtering, expandable table rows, side-by-side original vs. corrected diffs, and single-claim live re-verification.
- **Exportable Audit Reports**: Full 13-section report preview with PDF (`jspdf` + `jspdf-autotable`), formula-safe CSV, and structured JSON downloads.
- **Built-in Sample Audit PDF**: Download or run a generated 3-page corporate brief (`/api/sample-pdf`) containing accurate, outdated, false, repeated, and private claims to test the full pipeline end-to-end.

---

## Architecture

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Recharts, Lucide Icons, jsPDF
- **Backend**: Express + Multer (20 MB in-memory PDF upload with `%PDF-` header validation) + Server-Sent Events (`/api/analyze`)
- **AI & Grounding**: `@google/genai` server-side SDK (`gemini-4-hydrogen` + `{ googleSearch: {} }`)
- **PDF Processing**: `pdfjs-dist` (text layer extraction) + Gemini native PDF OCR fallback + `pdf-lib` (sample PDF synthesis)

---

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables (copy `.env.example` to `.env`):
   ```env
   GEMINI_API_KEY="your_gemini_api_key"
   PORT=3000
   ```

3. Start the development server (Express API + Vite frontend on port 3000):
   ```bash
   npm run dev
   ```

4. Build and run in production mode:
   ```bash
   npm run build
   NODE_ENV=production npx tsx server.ts
   ```

---

## Deploying to Google Cloud Run

```bash
gcloud run deploy the-fact-check-agent \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,GEMINI_API_KEY=YOUR_KEY"
```

---

## API Endpoints

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service health and configuration check |
| `GET` | `/api/sample-pdf` | Generates and serves the 3-page sample audit PDF |
| `POST` | `/api/analyze` | Accepts `multipart/form-data` (`file`) and streams real-time SSE verification progress + final `FactCheckReport` |
| `POST` | `/api/reverify-claim` | Re-runs live Google Search verification on an individual extracted claim |
