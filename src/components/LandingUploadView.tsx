import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Download,
  FileText,
  FlaskConical,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { FactCheckReport } from '../types/factCheck';
import { formatDateShort, formatFileSize, resolveSummaryMetrics } from '../utils/formatting';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

interface LandingUploadViewProps {
  selectedFile: File | null;
  onSelectFile: (file: File | null) => void;
  onStartAnalysis: (file: File) => void;
  onRunSampleAnalysis: () => void;
  isLoadingSample: boolean;
  externalError: string | null;
  recentReports: FactCheckReport[];
  onOpenReport: (report: FactCheckReport) => void;
  onDeleteReport: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export const LandingUploadView: React.FC<LandingUploadViewProps> = ({
  selectedFile,
  onSelectFile,
  onStartAnalysis,
  onRunSampleAnalysis,
  isLoadingSample,
  externalError,
  recentReports,
  onOpenReport,
  onDeleteReport,
  fileInputRef,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);

  const validateAndSelect = (file: File | null | undefined) => {
    setValidationError(null);
    if (!file) return;

    const lower = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
    if (!isPdf) {
      setValidationError('Unsupported file type. Please select a PDF document (.pdf).');
      return;
    }
    if (file.size === 0) {
      setValidationError('The selected PDF file is empty (0 bytes). Please choose another file.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setValidationError(
        `This file is ${formatFileSize(file.size)}, which exceeds the 20 MB upload limit.`
      );
      return;
    }

    onSelectFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    validateAndSelect(file);
    // Reset input value so re-selecting the same file after removal works
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    validateAndSelect(file);
  };

  const activeError = validationError || externalError;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-20">
      {/* Hero + Upload Focal Anchor */}
      <section
        id="upload-workspace"
        className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start"
      >
        {/* Left Editorial Pitch */}
        <div className="lg:col-span-6 space-y-6 pt-2">
          <p className="text-sm font-semibold text-[#2563EB] tracking-tight">
            Independent Truth Layer for Documents
          </p>

          <h1
            className="font-display text-4xl sm:text-5xl font-extrabold text-[#0F1E3D] tracking-tight leading-[1.1]"
            style={{ textWrap: 'balance' }}
          >
            Don&apos;t Just Publish. Verify.
          </h1>

          <p className="text-lg text-slate-600 leading-relaxed max-w-xl">
            AI-powered fact-checking that turns your PDFs into trusted information. Extract
            statistics, dates, financial claims, and technical specs—then cross-check every
            statement against live web sources with direct citations.
          </p>

          <div className="pt-2 border-t border-slate-200 grid grid-cols-3 gap-6 max-w-lg">
            <div>
              <p className="font-mono text-xl font-semibold text-[#0F1E3D] tabular-nums">
                Live Web
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Google Search grounded verification
              </p>
            </div>
            <div>
              <p className="font-mono text-xl font-semibold text-[#0F1E3D] tabular-nums">
                OCR Ready
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Text layers, tables &amp; scanned PDFs
              </p>
            </div>
            <div>
              <p className="font-mono text-xl font-semibold text-[#0F1E3D] tabular-nums">
                PDF / CSV
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Audit-ready export reports
              </p>
            </div>
          </div>
        </div>

        {/* Right Primary Upload Workspace */}
        <div className="lg:col-span-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4 pb-5 border-b border-slate-100">
              <div>
                <h2 className="font-display text-lg font-bold text-[#0F1E3D]">
                  Upload Document for Fact-Checking
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  PDF up to 20 MB · Text-based or scanned pages
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              className="sr-only"
              aria-label="Choose a PDF file to fact-check"
            />

            {!selectedFile ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`mt-6 rounded-lg border-2 border-dashed p-8 sm:p-10 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                  isDragging
                    ? 'border-[#2563EB] bg-blue-50/60'
                    : 'border-slate-300 bg-slate-50/60 hover:border-[#2563EB]/70 hover:bg-slate-50'
                }`}
              >
                <div className="mx-auto w-12 h-12 rounded-lg bg-[#0F1E3D]/5 text-[#0F1E3D] flex items-center justify-center mb-4">
                  <Upload className="w-6 h-6" aria-hidden="true" />
                </div>
                <p className="text-base font-semibold text-[#0F1E3D]">
                  {isDragging ? 'Drop your PDF here' : 'Drag and drop a PDF file here'}
                </p>
                <p className="text-sm text-slate-500 mt-1.5">
                  or{' '}
                  <span className="text-[#2563EB] font-semibold underline underline-offset-2">
                    browse from your device
                  </span>
                </p>
                <p className="text-xs text-slate-400 mt-4">
                  Supports research papers, investor decks, press releases, financial briefs &amp;
                  scanned PDFs
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[#0F1E3D] text-white flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0F1E3D] truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        {formatFileSize(selectedFile.size)} · PDF Document
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setValidationError(null);
                        onSelectFile(null);
                      }}
                      aria-label="Remove selected file"
                      className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onStartAnalysis(selectedFile)}
                  className="w-full py-3 px-5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
                >
                  <span>Analyze Document</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {activeError && (
              <div
                role="alert"
                className="mt-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
                <span>{activeError}</span>
              </div>
            )}

            {/* Sample Verification Document Strip */}
            <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                <span className="font-semibold text-[#0F1E3D]">Need a test document?</span> Try our
                3-page sample market brief with intentional outdated &amp; false stats.
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <a
                  href="/api/sample-pdf"
                  download="Meridian_Clean_Energy_and_Digital_Economy_Brief_2026.pdf"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Download PDF</span>
                </a>
                <button
                  type="button"
                  disabled={isLoadingSample}
                  onClick={onRunSampleAnalysis}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#2563EB] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isLoadingSample ? 'Loading…' : 'Run Sample Audit'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works — Clean 4-Step Editorial Strip */}
      <section id="how-it-works" className="pt-10 border-t border-slate-200">
        <div className="max-w-2xl mb-10">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0F1E3D] tracking-tight">
            How the verification pipeline works
          </h2>
          <p className="text-slate-600 mt-2">
            Every claim is isolated with its original page reference, checked against live
            authoritative web sources, and classified without guesswork.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            {
              step: '01.',
              title: 'Document & OCR Parsing',
              body: 'Extracts text, financial figures, and tables page-by-page. Automatically switches to optical character recognition when a PDF is scanned.',
            },
            {
              step: '02.',
              title: 'Atomic Claim Extraction',
              body: 'Isolates verifiable statistics, dates, growth rates, technical specs, and product claims while preserving verbatim wording and page numbers.',
            },
            {
              step: '03.',
              title: 'Live Web Grounding',
              body: 'Searches the live web for primary government, institutional, academic, and official corporate sources—never relying on stale memory alone.',
            },
            {
              step: '04.',
              title: 'Evidence-Backed Report',
              body: 'Flags outdated and false facts with verified corrections, time-period comparisons, clickable source URLs, and PDF, CSV, and JSON exports.',
            },
          ].map((item) => (
            <div key={item.step} className="space-y-2.5">
              <p className="font-mono text-xs font-semibold text-[#2563EB] tabular-nums">
                {item.step}
              </p>
              <h3 className="font-display text-base font-bold text-[#0F1E3D]">{item.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Classification Standards */}
      <section id="verification-standards" className="pt-10 border-t border-slate-200">
        <div className="max-w-2xl mb-8">
          <h2 className="font-display text-2xl font-bold text-[#0F1E3D] tracking-tight">
            Strict four-tier classification standard
          </h2>
          <p className="text-slate-600 mt-2 text-sm">
            Claims without public evidence are never falsely marked wrong, and outdated numbers are
            clearly distinguished from fabricated claims.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden">
          {[
            {
              label: 'Verified',
              color: 'text-emerald-700',
              desc: 'Directly supported by reliable, current, and contextually matching primary evidence.',
            },
            {
              label: 'Inaccurate',
              color: 'text-amber-700',
              desc: 'Outdated data presented as current, imprecise figures, or misleading comparisons. Includes corrected values and data periods.',
            },
            {
              label: 'False',
              color: 'text-red-700',
              desc: 'Directly contradicted by authoritative evidence. Supplies the verified factual correction and source links.',
            },
            {
              label: 'Unverified',
              color: 'text-slate-600',
              desc: 'Insufficient public reliable sources exist (e.g., private internal surveys). Never assumed false.',
            },
          ].map((tier) => (
            <div key={tier.label} className="bg-white p-6 space-y-2">
              <p className={`font-display text-sm font-bold ${tier.color}`}>{tier.label}</p>
              <p className="text-sm text-slate-600 leading-relaxed">{tier.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Audits History (persisted in localStorage) */}
      <section id="recent-audits" className="pt-10 border-t border-slate-200">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display text-2xl font-bold text-[#0F1E3D] tracking-tight">
              Recent Audits
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Saved locally in this browser for quick review and export.
            </p>
          </div>
        </div>

        {recentReports.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <p className="text-sm font-semibold text-[#0F1E3D]">No completed audits yet</p>
            <p className="text-sm text-slate-500 mt-1">
              Upload a PDF above or run the sample market brief to generate your first verification
              report.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
            {recentReports.map((rep) => {
              const repMetrics = resolveSummaryMetrics(rep.summary);
              return (
                <div
                  key={rep.id}
                  className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/80 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <button
                      type="button"
                      onClick={() => onOpenReport(rep)}
                      className="font-display text-sm font-bold text-[#0F1E3D] hover:text-[#2563EB] transition-colors text-left truncate block max-w-full"
                    >
                      {rep.documentName}
                    </button>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 tabular-nums">
                      <span className="font-mono">{rep.id}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDateShort(rep.analysisDate)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{rep.pageCount} pages</span>
                      <span aria-hidden="true">·</span>
                      <span>{rep.summary.totalClaims} claims</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-[#0F1E3D]">
                        {repMetrics.verifiedTrueShareLabel} verified-true
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-[#2563EB]">
                        {repMetrics.verificationCoverage}% coverage
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-700">{rep.summary.verified} verified</span>
                      <span aria-hidden="true">/</span>
                      <span className="text-amber-700">{rep.summary.inaccurate} inaccurate</span>
                      <span aria-hidden="true">/</span>
                      <span className="text-red-700">{rep.summary.falseCount} false</span>
                    </div>
                  </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenReport(rep)}
                    className="px-3.5 py-1.5 text-xs font-semibold text-[#0F1E3D] bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                  >
                    Open Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteReport(rep.id)}
                    aria-label={`Delete audit ${rep.documentName}`}
                    className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};
