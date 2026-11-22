import React from 'react';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import type { FactCheckReport } from '../types/factCheck';
import { exportReportAsCsv, exportReportAsJson, exportReportAsPdf } from '../utils/exporters';
import {
  formatDateShort,
  formatDateTime,
  getSafeHref,
  resolveSummaryMetrics,
} from '../utils/formatting';
import { StatusIndicator } from './StatusIndicator';

interface ReportPreviewViewProps {
  report: FactCheckReport;
  onBackToDashboard: () => void;
}

export const ReportPreviewView: React.FC<ReportPreviewViewProps> = ({
  report,
  onBackToDashboard,
}) => {
  const correctedClaims = report.claims.filter(
    (c) => (c.status === 'INACCURATE' || c.status === 'FALSE') && c.correctedStatement
  );
  const metrics = resolveSummaryMetrics(report.summary);

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Export Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <button
          type="button"
          onClick={onBackToDashboard}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-[#0F1E3D] transition-colors w-fit"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to Interactive Dashboard</span>
        </button>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => exportReportAsPdf(report)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors whitespace-nowrap"
          >
            <FileText className="w-4 h-4" aria-hidden="true" />
            <span>Download PDF</span>
          </button>
          <button
            type="button"
            onClick={() => exportReportAsCsv(report)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0F1E3D] bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
            <span>Download CSV</span>
          </button>
          <button
            type="button"
            onClick={() => exportReportAsJson(report)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0F1E3D] bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileJson className="w-4 h-4" aria-hidden="true" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {/* Publication-Ready Audit Report Document */}
      <article className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Report Masthead */}
        <header className="bg-[#0F1E3D] text-white px-6 sm:px-10 py-8 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-blue-200 font-mono tabular-nums">
            <span>THE FACT-CHECK AGENT  ·  VERIFICATION AUDIT REPORT</span>
            <span>AUDIT ID: {report.id}</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
            {report.documentName}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300 tabular-nums">
            <span>Analyzed: {formatDateTime(report.analysisDate)}</span>
            <span aria-hidden="true">·</span>
            <span>{report.pageCount} Pages</span>
            <span aria-hidden="true">·</span>
            <span>
              Extraction: {report.extractionMethod === 'ocr' ? 'AI OCR' : 'Direct Text Layer'}
            </span>
          </div>
        </header>

        <div className="p-6 sm:p-10 space-y-10">
          {/* 1. Quantitative Verification Overview */}
          <section className="space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0F1E3D] pb-2 border-b border-slate-200">
              1. Verification Summary &amp; Claim Breakdown
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">Verified-True Share</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {metrics.resolvedClaims === 0
                      ? 'No claims resolved with public evidence'
                      : `${report.summary.verified} of ${metrics.resolvedClaims} resolved claims accurate`}
                  </p>
                </div>
                <p
                  className={`font-mono text-2xl font-bold tabular-nums ${
                    metrics.verifiedTrueShare === null
                      ? 'text-slate-500'
                      : metrics.verifiedTrueShare >= 80
                        ? 'text-emerald-700'
                        : metrics.verifiedTrueShare >= 50
                          ? 'text-amber-700'
                          : 'text-red-700'
                  }`}
                >
                  {metrics.verifiedTrueShareLabel}
                </p>
              </div>

              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">Verification Coverage</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {metrics.resolvedClaims} of {report.summary.totalClaims} claims resolved via live web
                  </p>
                </div>
                <p className="font-mono text-2xl font-bold text-[#2563EB] tabular-nums">
                  {metrics.verificationCoverage}%
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center">
              {[
                {
                  label: 'Total Claims',
                  value: String(report.summary.totalClaims),
                  color: 'text-[#0F1E3D]',
                },
                {
                  label: 'Verified as Accurate',
                  value: String(report.summary.verified),
                  color: 'text-emerald-700',
                },
                {
                  label: 'Inaccurate',
                  value: String(report.summary.inaccurate),
                  color: 'text-amber-700',
                },
                {
                  label: 'False',
                  value: String(report.summary.falseCount),
                  color: 'text-red-700',
                },
                {
                  label: 'Unverified',
                  value: String(report.summary.unverified),
                  color: 'text-slate-600',
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="p-3.5 rounded-lg bg-slate-50 border border-slate-200"
                >
                  <p className={`font-mono text-2xl font-bold tabular-nums ${stat.color}`}>
                    {stat.value}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">{metrics.metricBasis}.</p>
          </section>

          {/* 2. Executive Summary */}
          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold text-[#0F1E3D] pb-2 border-b border-slate-200">
              2. Executive Summary
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">{report.executiveSummary}</p>
          </section>

          {/* 3. Corrected Facts & Statistics */}
          <section className="space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0F1E3D] pb-2 border-b border-slate-200">
              3. Corrected Facts &amp; Statistics ({correctedClaims.length})
            </h2>
            {correctedClaims.length === 0 ? (
              <p className="text-sm text-slate-600">
                No inaccurate or false claims requiring factual replacement were identified.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {correctedClaims.map((claim) => (
                  <div key={claim.id} className="p-4 space-y-2.5 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-500 tabular-nums">
                        <span className="font-bold text-[#0F1E3D]">{claim.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>Page {claim.pageNumber}</span>
                        {claim.differenceSummary && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-800 font-semibold">
                              {claim.differenceSummary}
                            </span>
                          </>
                        )}
                      </div>
                      <StatusIndicator status={claim.status} size="sm" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-1">
                        <p className="font-semibold text-slate-500">Original PDF Statement</p>
                        <p className="text-slate-800 leading-relaxed">{claim.originalClaim}</p>
                        {claim.originalDataPeriod && (
                          <p className="font-mono text-[11px] text-slate-500">
                            PDF period: {claim.originalDataPeriod}
                          </p>
                        )}
                      </div>
                      <div className="p-3 rounded-md bg-emerald-50/40 border border-emerald-200/80 space-y-1.5">
                        <p className="font-semibold text-emerald-800">Verified Correction</p>
                        <p className="text-[#0F1E3D] font-medium leading-relaxed">
                          {claim.correctedStatement}
                        </p>
                        {claim.latestDataPeriod && (
                          <p className="font-mono text-[11px] text-emerald-800">
                            Verified period: {claim.latestDataPeriod}
                          </p>
                        )}
                        {claim.correctionSourceExcerpt && (
                          <blockquote className="pt-1.5 mt-1 border-t border-emerald-200/70 text-[11px] text-slate-600 italic leading-relaxed">
                            Source excerpt: &ldquo;{claim.correctionSourceExcerpt}&rdquo;
                          </blockquote>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 4. Complete Claim-by-Claim Findings & Source URLs */}
          <section className="space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0F1E3D] pb-2 border-b border-slate-200">
              4. Detailed Claim-by-Claim Findings &amp; Evidence
            </h2>
            <div className="space-y-4">
              {report.claims.map((claim) => {
                const safeSources = claim.sources
                  .map((s) => ({ ...s, safeHref: getSafeHref(s.url) }))
                  .filter((s) => s.safeHref !== null);

                return (
                  <div
                    key={claim.id}
                    className="p-4 sm:p-5 rounded-lg border border-slate-200 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                        <span className="font-bold text-[#0F1E3D]">{claim.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>Page {claim.pageNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span>{claim.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>Checked {formatDateShort(claim.lastVerifiedDate)}</span>
                      </div>
                      <StatusIndicator status={claim.status} size="sm" />
                    </div>

                    <p className="text-sm font-semibold text-[#0F1E3D] leading-snug">
                      &ldquo;{claim.originalClaim}&rdquo;
                    </p>

                    <p className="text-xs text-slate-700 leading-relaxed">{claim.explanation}</p>

                    {(claim.supportingEvidence.length > 0 || claim.contradictoryEvidence.length > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <div className="p-3 rounded-md bg-emerald-50/35 border border-emerald-200/70 space-y-1 text-xs">
                          <p className="font-semibold text-emerald-800">Supporting Evidence</p>
                          {claim.supportingEvidence.length > 0 ? (
                            <ul className="space-y-1 text-slate-700 list-disc pl-4 leading-relaxed">
                              {claim.supportingEvidence.map((item, idx) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-slate-500">None identified.</p>
                          )}
                        </div>
                        <div className="p-3 rounded-md bg-red-50/35 border border-red-200/70 space-y-1 text-xs">
                          <p className="font-semibold text-red-800">Contradictory Evidence</p>
                          {claim.contradictoryEvidence.length > 0 ? (
                            <ul className="space-y-1 text-slate-700 list-disc pl-4 leading-relaxed">
                              {claim.contradictoryEvidence.map((item, idx) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-slate-500">None identified.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {safeSources.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 space-y-1">
                        <p className="text-[11px] font-semibold text-slate-500">
                          Verified Source URLs
                        </p>
                        <ul className="space-y-1">
                          {safeSources.map((src, idx) => (
                            <li key={idx} className="text-xs">
                              <a
                                href={src.safeHref!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex flex-wrap items-center gap-1.5 text-[#2563EB] hover:underline break-all"
                              >
                                <span>{src.title}</span>
                                <span className="text-slate-400 font-mono">({src.domain})</span>
                                {src.publicationDate && (
                                  <span className="text-slate-500 font-mono tabular-nums">
                                    · Published {src.publicationDate}
                                  </span>
                                )}
                                <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 5. Final Recommendations */}
          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold text-[#0F1E3D] pb-2 border-b border-slate-200">
              5. Final Recommendations
            </h2>
            <ol className="space-y-2.5 text-sm text-slate-700">
              {report.recommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-bold text-[#2563EB] mt-0.5 tabular-nums">
                    {String(idx + 1).padStart(2, '0')}.
                  </span>
                  <span className="leading-relaxed">{rec}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* Bottom Export Bar */}
        <footer className="px-6 sm:px-10 py-5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            Generated by The Fact-Check Agent · Export full audit data for distribution or archiving
          </p>
          <button
            type="button"
            onClick={() => exportReportAsPdf(report)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F1E3D] hover:bg-[#172B54] rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Download Full PDF Report</span>
          </button>
        </footer>
      </article>
    </main>
  );
};
