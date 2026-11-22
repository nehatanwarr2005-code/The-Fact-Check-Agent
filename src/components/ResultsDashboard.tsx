import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDown,
  FileSearch,
  Info,
  Search,
  Upload,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ClaimStatus, FactCheckReport, VerifiedClaim } from '../types/factCheck';
import {
  formatDateShort,
  formatFileSize,
  getSafeHref,
  resolveSummaryMetrics,
  STATUS_CONFIG,
} from '../utils/formatting';
import { StatusIndicator } from './StatusIndicator';

interface ResultsDashboardProps {
  report: FactCheckReport;
  onInspectClaim: (claimId: string) => void;
  onOpenReportPreview: () => void;
  onStartNewAudit: () => void;
}

type StatusFilter = 'ALL' | ClaimStatus;

export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({
  report,
  onInspectClaim,
  onOpenReportPreview,
  onStartNewAudit,
}) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [pageFilter, setPageFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const availablePages = useMemo(() => {
    const set = new Set<number>();
    report.claims.forEach((c) => {
      set.add(c.pageNumber);
      c.additionalPages?.forEach((p) => set.add(p));
    });
    return [...set].sort((a, b) => a - b);
  }, [report.claims]);

  const filteredClaims = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return report.claims.filter((claim) => {
      if (statusFilter !== 'ALL' && claim.status !== statusFilter) return false;
      if (pageFilter !== 'ALL') {
        const targetPage = Number(pageFilter);
        const onPage =
          claim.pageNumber === targetPage ||
          Boolean(claim.additionalPages?.includes(targetPage));
        if (!onPage) return false;
      }
      if (q) {
        const haystack = [
          claim.id,
          claim.originalClaim,
          claim.evidenceSummary,
          claim.correctedStatement ?? '',
          claim.category,
          claim.explanation,
          ...claim.sources.map((s) => `${s.title} ${s.domain}`),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [report.claims, statusFilter, pageFilter, searchQuery]);

  const chartData = useMemo(
    () => [
      {
        name: STATUS_CONFIG.VERIFIED.label,
        count: report.summary.verified,
        color: STATUS_CONFIG.VERIFIED.chartHex,
      },
      {
        name: STATUS_CONFIG.INACCURATE.label,
        count: report.summary.inaccurate,
        color: STATUS_CONFIG.INACCURATE.chartHex,
      },
      {
        name: STATUS_CONFIG.FALSE.label,
        count: report.summary.falseCount,
        color: STATUS_CONFIG.FALSE.chartHex,
      },
      {
        name: STATUS_CONFIG.UNVERIFIED.label,
        count: report.summary.unverified,
        color: STATUS_CONFIG.UNVERIFIED.chartHex,
      },
    ],
    [report.summary]
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const metrics = useMemo(() => resolveSummaryMetrics(report.summary), [report.summary]);

  const verifiedShareColorClass =
    metrics.verifiedTrueShare === null
      ? 'text-slate-500'
      : metrics.verifiedTrueShare >= 80
        ? 'text-emerald-700'
        : metrics.verifiedTrueShare >= 50
          ? 'text-amber-700'
          : 'text-red-700';

  const verifiedShareBarClass =
    metrics.verifiedTrueShare === null
      ? 'bg-slate-300'
      : metrics.verifiedTrueShare >= 80
        ? 'bg-emerald-600'
        : metrics.verifiedTrueShare >= 50
          ? 'bg-amber-500'
          : 'bg-red-600';

  const verifiedShareSubtitle =
    metrics.resolvedClaims === 0
      ? 'No claims resolved with public evidence'
      : report.summary.verified === 0
        ? `0 of ${metrics.resolvedClaims} resolved accurate (${report.summary.inaccurate} inaccurate, ${report.summary.falseCount} false)`
        : `${report.summary.verified} of ${metrics.resolvedClaims} resolved claims accurate`;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Document Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 font-mono tabular-nums">
            <span>Audit {report.id}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDateShort(report.analysisDate)}</span>
            <span aria-hidden="true">·</span>
            <span>{report.pageCount} pages</span>
            <span aria-hidden="true">·</span>
            <span>{formatFileSize(report.fileSizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {report.extractionMethod === 'ocr' ? 'AI OCR Extraction' : 'Direct PDF Text'}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0F1E3D] tracking-tight break-words">
            {report.documentName}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onStartNewAudit}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <Upload className="w-4 h-4" aria-hidden="true" />
            <span>New PDF</span>
          </button>
          <button
            type="button"
            onClick={onOpenReportPreview}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors whitespace-nowrap"
          >
            <FileDown className="w-4 h-4" aria-hidden="true" />
            <span>Report &amp; Export</span>
          </button>
        </div>
      </div>

      {/* Transparency Warnings (only rendered if applicable) */}
      {!report.liveSearchAvailable && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">Live web search returned no grounded sources</p>
            <p className="text-amber-800 mt-0.5">
              Because live search evidence could not be retrieved, claims were conservatively marked
              as Unverified rather than assuming accuracy. You can retry individual claims from the
              detail inspector.
            </p>
          </div>
        </div>
      )}

      {report.extractionNotes && (
        <div className="p-3.5 rounded-lg bg-slate-100/80 border border-slate-200 text-slate-700 text-xs flex items-start gap-2.5">
          <Info className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" aria-hidden="true" />
          <span>{report.extractionNotes}</span>
        </div>
      )}

      {/* Summary Metrics: Accuracy & Verification Coverage + 5 Claim Breakdown Counts */}
      <section aria-label="Verification summary statistics">
        <div className="bg-slate-200 border border-slate-200 rounded-xl overflow-hidden space-y-px">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px">
            <div className="bg-white p-5 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">Verified-True Share</p>
                <p className="text-xs text-slate-500 tabular-nums">{verifiedShareSubtitle}</p>
              </div>
              <p className={`font-mono text-2xl sm:text-3xl font-bold tabular-nums ${verifiedShareColorClass}`}>
                {metrics.verifiedTrueShareLabel}
              </p>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${verifiedShareBarClass}`}
                  style={{ width: `${metrics.verifiedTrueShare ?? 0}%` }}
                />
              </div>
            </div>

            <div className="bg-white p-5 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">Verification Coverage</p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {metrics.resolvedClaims} of {report.summary.totalClaims} claims resolved via live web
                </p>
              </div>
              <p className="font-mono text-2xl sm:text-3xl font-bold text-[#2563EB] tabular-nums">
                {metrics.verificationCoverage}%
              </p>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#2563EB]"
                  style={{ width: `${metrics.verificationCoverage}%` }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px">
            <div className="bg-white p-5 space-y-1.5">
              <p className="text-xs font-medium text-slate-500">Total Claims</p>
              <p className="font-mono text-2xl sm:text-3xl font-bold text-[#0F1E3D] tabular-nums">
                {report.summary.totalClaims}
              </p>
              <p className="text-xs text-slate-400">Extracted &amp; audited</p>
            </div>

            <div className="bg-white p-5 space-y-1.5">
              <p className="text-xs font-medium text-emerald-700">Verified as Accurate</p>
              <p className="font-mono text-2xl sm:text-3xl font-bold text-emerald-700 tabular-nums">
                {report.summary.verified}
              </p>
              <p className="text-xs text-slate-400">Supported by live web</p>
            </div>

            <div className="bg-white p-5 space-y-1.5">
              <p className="text-xs font-medium text-amber-700">Inaccurate</p>
              <p className="font-mono text-2xl sm:text-3xl font-bold text-amber-700 tabular-nums">
                {report.summary.inaccurate}
              </p>
              <p className="text-xs text-slate-400">Outdated or imprecise</p>
            </div>

            <div className="bg-white p-5 space-y-1.5">
              <p className="text-xs font-medium text-red-700">False</p>
              <p className="font-mono text-2xl sm:text-3xl font-bold text-red-700 tabular-nums">
                {report.summary.falseCount}
              </p>
              <p className="text-xs text-slate-400">Directly contradicted</p>
            </div>

            <div className="bg-white p-5 space-y-1.5 col-span-2 sm:col-span-1">
              <p className="text-xs font-medium text-slate-600">Unverified</p>
              <p className="font-mono text-2xl sm:text-3xl font-bold text-slate-600 tabular-nums">
                {report.summary.unverified}
              </p>
              <p className="text-xs text-slate-400">No public proof found</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">{metrics.metricBasis}.</p>
      </section>

      {/* Distribution Chart & Executive Summary */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col">
          <div className="mb-4">
            <h2 className="font-display text-base font-bold text-[#0F1E3D]">
              Status Distribution
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any status filter below to isolate claims
            </p>
          </div>
          <div className="flex-1 min-h-[210px] w-full">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 20, left: 6, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: '#64748B', fontFamily: 'IBM Plex Mono' }}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={132}
                  tick={{ fontSize: 11, fill: '#0F1E3D', fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#F8FAFC' }}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(15,30,61,0.08)',
                  }}
                />
                <Bar dataKey="count" name="Claims" radius={[0, 4, 4, 0]} barSize={22}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-3">
            <h2 className="font-display text-base font-bold text-[#0F1E3D]">
              Executive Summary
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">{report.executiveSummary}</p>
          </div>

          {report.recommendations.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <h3 className="text-xs font-bold text-slate-500">Top Recommendations</h3>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {report.recommendations.slice(0, 3).map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="font-mono text-xs font-semibold text-[#2563EB] mt-0.5 tabular-nums">
                      0{idx + 1}.
                    </span>
                    <span className="leading-snug">{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Claim-by-Claim Results Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Toolbar: Segmented Status Filter + Search + Page Select */}
        <div className="p-4 sm:px-6 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          {/* Interactive Segmented Control */}
          <div
            role="tablist"
            aria-label="Filter claims by verification status"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
          >
            {(
              [
                { key: 'ALL', label: 'All', count: report.summary.totalClaims },
                { key: 'VERIFIED', label: STATUS_CONFIG.VERIFIED.label, count: report.summary.verified },
                { key: 'INACCURATE', label: STATUS_CONFIG.INACCURATE.label, count: report.summary.inaccurate },
                { key: 'FALSE', label: STATUS_CONFIG.FALSE.label, count: report.summary.falseCount },
                { key: 'UNVERIFIED', label: STATUS_CONFIG.UNVERIFIED.label, count: report.summary.unverified },
              ] as Array<{ key: StatusFilter; label: string; count: number }>
            ).map((tab) => {
              const active = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    active
                      ? 'bg-white text-[#0F1E3D] shadow-xs'
                      : 'text-slate-600 hover:text-[#0F1E3D]'
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              );
            })}
          </div>

          {/* Search & Page Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1 sm:w-72">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search claims, corrections, sources…"
                aria-label="Search extracted claims"
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-[#0F1E3D] placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
              />
            </div>

            {availablePages.length > 1 && (
              <select
                value={pageFilter}
                onChange={(e) => setPageFilter(e.target.value)}
                aria-label="Filter claims by page number"
                className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-[#0F1E3D] focus:outline-none focus:bg-white focus:border-[#2563EB]"
              >
                <option value="ALL">All Pages ({report.pageCount})</option>
                {availablePages.map((p) => (
                  <option key={p} value={String(p)}>
                    Page {p}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Table */}
        {filteredClaims.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <FileSearch className="w-8 h-8 text-slate-300 mx-auto" aria-hidden="true" />
            <p className="text-sm font-semibold text-[#0F1E3D]">
              {report.claims.length === 0
                ? 'No verifiable factual claims found in this PDF'
                : 'No claims match your current filters'}
            </p>
            <p className="text-xs text-slate-500">
              {report.claims.length === 0
                ? 'Try uploading a report containing statistics, dates, financial data, or technical specifications.'
                : 'Clear your search query or switch the status filter back to All.'}
            </p>
            {report.claims.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('ALL');
                  setPageFilter('ALL');
                  setSearchQuery('');
                }}
                className="mt-2 px-3.5 py-1.5 text-xs font-semibold text-[#2563EB] hover:underline"
              >
                Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[980px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 pl-4 pr-2 w-10">
                    <span className="sr-only">Expand</span>
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap">Claim ID</th>
                  <th className="py-3 px-3 whitespace-nowrap">Page</th>
                  <th className="py-3 px-3 w-[25%]">Original Claim</th>
                  <th className="py-3 px-3 whitespace-nowrap">Verification Status</th>
                  <th className="py-3 px-3 w-[20%]">Evidence Found</th>
                  <th className="py-3 px-3 w-[20%]">Corrected Information</th>
                  <th className="py-3 px-3 whitespace-nowrap">Source Links</th>
                  <th className="py-3 px-3 whitespace-nowrap">Last Verified</th>
                  <th className="py-3 pl-2 pr-4 text-right whitespace-nowrap">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredClaims.map((claim: VerifiedClaim) => {
                  const isExpanded = Boolean(expandedIds[claim.id]);
                  const safeSources = claim.sources
                    .map((s) => ({ ...s, safeHref: getSafeHref(s.url) }))
                    .filter((s) => s.safeHref !== null);

                  return (
                    <React.Fragment key={claim.id}>
                      <tr className="hover:bg-slate-50/80 transition-colors align-top">
                        <td className="py-3.5 pl-4 pr-2">
                          <button
                            type="button"
                            onClick={() => toggleExpand(claim.id)}
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} explanation for ${claim.id}`}
                            className="p-1 text-slate-400 hover:text-[#0F1E3D] rounded transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        </td>

                        <td className="py-3.5 px-3 font-mono text-xs font-semibold text-[#0F1E3D] whitespace-nowrap tabular-nums">
                          {claim.id}
                        </td>

                        <td className="py-3.5 px-3 font-mono text-xs text-slate-600 whitespace-nowrap tabular-nums">
                          p. {claim.pageNumber}
                          {claim.additionalPages && claim.additionalPages.length > 0 && (
                            <span className="text-slate-400">
                              , {claim.additionalPages.join(', ')}
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-3">
                          <button
                            type="button"
                            onClick={() => onInspectClaim(claim.id)}
                            className="text-left text-sm text-[#0F1E3D] hover:text-[#2563EB] leading-snug font-medium transition-colors"
                          >
                            {claim.originalClaim}
                          </button>
                          <p className="text-xs text-slate-400 mt-1">{claim.category}</p>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <StatusIndicator status={claim.status} size="sm" />
                        </td>

                        <td className="py-3.5 px-3 text-xs text-slate-600 leading-relaxed">
                          {claim.evidenceSummary}
                        </td>

                        <td className="py-3.5 px-3 text-xs leading-relaxed">
                          {claim.correctedStatement ? (
                            <div className="space-y-1.5">
                              <p className="text-[#0F1E3D] font-medium">
                                {claim.correctedStatement}
                              </p>
                              {claim.differenceSummary && (
                                <p className="font-mono text-[11px] text-amber-800">
                                  {claim.differenceSummary}
                                </p>
                              )}
                              {claim.correctionSourceExcerpt && (
                                <p className="text-[11px] text-slate-500 italic border-l-2 border-slate-300 pl-2 line-clamp-2">
                                  &ldquo;{claim.correctionSourceExcerpt}&rdquo;
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-3 text-xs">
                          {safeSources.length > 0 ? (
                            <div className="space-y-1.5">
                              {safeSources.slice(0, 2).map((src, idx) => (
                                <div key={`${claim.id}-src-${idx}`} className="leading-tight">
                                  <a
                                    href={src.safeHref!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[#2563EB] hover:underline max-w-[165px]"
                                    title={
                                      src.publicationDate
                                        ? `${src.title} (Published ${src.publicationDate})`
                                        : src.title
                                    }
                                  >
                                    <span className="truncate">{src.domain}</span>
                                    <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  </a>
                                  {src.publicationDate && (
                                    <span className="block font-mono text-[10px] text-slate-400 tabular-nums">
                                      {src.publicationDate}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {safeSources.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => onInspectClaim(claim.id)}
                                  className="text-[11px] text-slate-500 hover:text-[#0F1E3D]"
                                >
                                  +{safeSources.length - 2} more
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">None found</span>
                          )}
                        </td>

                        <td className="py-3.5 px-3 font-mono text-xs text-slate-500 whitespace-nowrap tabular-nums">
                          {formatDateShort(claim.lastVerifiedDate)}
                        </td>

                        <td className="py-3.5 pl-2 pr-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onInspectClaim(claim.id)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-[#0F1E3D] bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Inline Evidence Preview Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50/90">
                          <td colSpan={10} className="px-6 py-4 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
                              <div className="space-y-1.5">
                                <p className="font-semibold text-[#0F1E3D]">
                                  Verification Rationale
                                </p>
                                <p className="text-slate-600 leading-relaxed">
                                  {claim.explanation}
                                </p>
                              </div>

                              <div className="space-y-1.5">
                                <p className="font-semibold text-emerald-700">
                                  Supporting Evidence
                                </p>
                                {claim.supportingEvidence.length > 0 ? (
                                  <ul className="space-y-1 text-slate-600 list-disc pl-4 leading-relaxed">
                                    {claim.supportingEvidence.map((item, idx) => (
                                      <li key={idx}>{item}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-slate-400">No supporting evidence identified.</p>
                                )}
                              </div>

                              <div className="space-y-1.5">
                                <p className="font-semibold text-red-700">
                                  Contradictory Evidence
                                </p>
                                {claim.contradictoryEvidence.length > 0 ? (
                                  <ul className="space-y-1 text-slate-600 list-disc pl-4 leading-relaxed">
                                    {claim.contradictoryEvidence.map((item, idx) => (
                                      <li key={idx}>{item}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-slate-400">No contradictory evidence identified.</p>
                                )}
                              </div>
                            </div>

                            <div className="pt-3 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
                                <span>
                                  PDF Period:{' '}
                                  <span className="font-medium text-[#0F1E3D]">
                                    {claim.originalDataPeriod || 'Not specified'}
                                  </span>
                                </span>
                                <span>
                                  Verified Period:{' '}
                                  <span className="font-medium text-[#0F1E3D]">
                                    {claim.latestDataPeriod || 'Current live evidence'}
                                  </span>
                                </span>
                                {claim.extractedValues.length > 0 && (
                                  <span className="font-mono">
                                    Figures: {claim.extractedValues.join(' · ')}
                                  </span>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={() => onInspectClaim(claim.id)}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0F1E3D] hover:bg-[#172B54] rounded-md transition-colors shrink-0 w-fit"
                              >
                                Open Full Claim Analysis
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
};
