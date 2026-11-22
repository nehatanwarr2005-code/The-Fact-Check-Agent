import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import type { VerifiedClaim } from '../types/factCheck';
import { formatDateShort, getSafeHref, STATUS_CONFIG } from '../utils/formatting';
import { StatusIndicator } from './StatusIndicator';

interface ClaimDetailDrawerProps {
  claim: VerifiedClaim;
  currentIndex: number;
  totalClaims: number;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onReverify: (claim: VerifiedClaim) => Promise<void>;
}

export const ClaimDetailDrawer: React.FC<ClaimDetailDrawerProps> = ({
  claim,
  currentIndex,
  totalClaims,
  onClose,
  onNavigate,
  onReverify,
}) => {
  const [isReverifying, setIsReverifying] = useState(false);
  const [reverifyError, setReverifyError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setReverifyError(null);
  }, [claim.id]);

  const handleReverify = async () => {
    setIsReverifying(true);
    setReverifyError(null);
    try {
      await onReverify(claim);
    } catch (err) {
      setReverifyError(
        err instanceof Error ? err.message : 'Unable to re-verify claim at this time.'
      );
    } finally {
      setIsReverifying(false);
    }
  };

  const safeSources = claim.sources
    .map((src) => ({ ...src, safeHref: getSafeHref(src.url) }))
    .filter((src) => src.safeHref !== null);

  const hasCorrectionComparison = Boolean(
    claim.correctedStatement || claim.originalValue || claim.correctedValue
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#0F1E3D]/35 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-detail-title"
    >
      {/* Backdrop click target */}
      <div className="flex-1" onClick={onClose} aria-hidden="true" />

      {/* Detail Panel */}
      <aside className="relative w-full max-w-2xl bg-white h-full border-l border-slate-200 flex flex-col overflow-hidden shadow-xl">
        {/* Sticky Panel Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-sm font-bold text-[#0F1E3D] tabular-nums">
              {claim.id}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              /
            </span>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              Page {claim.pageNumber}
              {claim.additionalPages && claim.additionalPages.length > 0
                ? ` (also p. ${claim.additionalPages.join(', ')})`
                : ''}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <StatusIndicator status={claim.status} size="sm" />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={currentIndex <= 0}
              onClick={() => onNavigate('prev')}
              aria-label="Previous claim"
              className="p-1.5 text-slate-500 hover:text-[#0F1E3D] hover:bg-slate-100 rounded-md disabled:opacity-35 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-slate-500 tabular-nums px-1">
              {currentIndex + 1}/{totalClaims}
            </span>
            <button
              type="button"
              disabled={currentIndex >= totalClaims - 1}
              onClick={() => onNavigate('next')}
              aria-label="Next claim"
              className="p-1.5 text-slate-500 hover:text-[#0F1E3D] hover:bg-slate-100 rounded-md disabled:opacity-35 transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close claim analysis panel"
              className="ml-2 p-1.5 text-slate-500 hover:text-[#0F1E3D] hover:bg-slate-100 rounded-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Original Statement */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span className="font-semibold text-[#0F1E3D]">Original Statement from PDF</span>
              <span>
                {claim.category} · Checked {formatDateShort(claim.lastVerifiedDate)}
              </span>
            </div>
            <blockquote
              id="claim-detail-title"
              className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-base font-medium text-[#0F1E3D] leading-relaxed"
            >
              &ldquo;{claim.originalClaim}&rdquo;
            </blockquote>
            {claim.extractedValues.length > 0 && (
              <p className="text-xs text-slate-500 font-mono">
                Extracted values:{' '}
                <span className="text-[#0F1E3D] font-medium">
                  {claim.extractedValues.join(' · ')}
                </span>
              </p>
            )}
          </section>

          {/* Original vs Corrected Comparison (when inaccurate/false or values differ) */}
          {hasCorrectionComparison && (
            <section className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <h3 className="font-display text-xs font-bold text-[#0F1E3D]">
                  Document Claim vs. Independently Verified Fact
                </h3>
                {claim.differenceSummary && (
                  <span className="font-mono text-xs font-semibold text-amber-800">
                    {claim.differenceSummary}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                <div className="p-4 space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500">Stated in PDF</p>
                  <p className="text-sm font-medium text-[#0F1E3D]">
                    {claim.originalValue || claim.originalClaim}
                  </p>
                  {claim.originalDataPeriod && (
                    <p className="text-xs text-slate-500 font-mono">
                      Data period: {claim.originalDataPeriod}
                    </p>
                  )}
                </div>

                <div className="p-4 space-y-1.5 bg-emerald-50/35">
                  <p className="text-xs font-semibold text-emerald-800">Verified Fact</p>
                  <p className="text-sm font-semibold text-[#0F1E3D]">
                    {claim.correctedValue ||
                      claim.correctedStatement ||
                      (claim.status === 'VERIFIED'
                        ? 'Confirmed accurate by live evidence.'
                        : 'No verified replacement value available.')}
                  </p>
                  {claim.latestDataPeriod && (
                    <p className="text-xs text-emerald-800 font-mono">
                      Latest period: {claim.latestDataPeriod}
                    </p>
                  )}
                </div>
              </div>

              {claim.correctedStatement && (
                <div className="px-4 py-3 border-t border-slate-200 bg-white space-y-2">
                  <p className="text-xs font-semibold text-[#2563EB]">
                    Recommended Corrected Statement
                  </p>
                  <p className="text-sm text-[#0F1E3D] leading-relaxed">
                    {claim.correctedStatement}
                  </p>
                  {claim.correctionSourceExcerpt && (
                    <div className="pt-2 border-t border-slate-100 space-y-1">
                      <p className="text-[11px] font-semibold text-slate-500">
                        Supporting Source Excerpt
                        {safeSources[0] ? ` (${safeSources[0].domain}${safeSources[0].publicationDate ? ` · ${safeSources[0].publicationDate}` : ''})` : ''}
                      </p>
                      <blockquote className="text-xs text-slate-600 italic border-l-2 border-[#2563EB]/40 pl-3 leading-relaxed">
                        &ldquo;{claim.correctionSourceExcerpt}&rdquo;
                      </blockquote>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* AI Interpretation & Classification Explanation */}
          <section className="space-y-4 pt-2 border-t border-slate-100">
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-slate-500">Claim Interpretation</h3>
              <p className="text-sm text-slate-700 leading-relaxed">{claim.interpretation}</p>
            </div>

            <div className="space-y-1">
              <h3 className="text-xs font-bold text-slate-500">
                Why This Claim Was Marked {STATUS_CONFIG[claim.status].label}
              </h3>
              <p className="text-sm text-[#0F1E3D] leading-relaxed">{claim.explanation}</p>
            </div>
          </section>

          {/* Supporting & Contradictory Evidence (always presented separately) */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div className="p-3.5 rounded-lg bg-emerald-50/35 border border-emerald-200/70 space-y-2">
              <h3 className="text-xs font-bold text-emerald-800">Supporting Evidence</h3>
              {claim.supportingEvidence.length > 0 ? (
                <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4 leading-relaxed">
                  {claim.supportingEvidence.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">No supporting evidence identified.</p>
              )}
            </div>

            <div className="p-3.5 rounded-lg bg-red-50/35 border border-red-200/70 space-y-2">
              <h3 className="text-xs font-bold text-red-800">Contradictory Evidence</h3>
              {claim.contradictoryEvidence.length > 0 ? (
                <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4 leading-relaxed">
                  {claim.contradictoryEvidence.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">No contradictory evidence identified.</p>
              )}
            </div>
          </section>

          {/* Source Disagreement Disclosure */}
          {claim.sourceDisagreement && (
            <section className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-semibold">Source Disagreement Noted</p>
                <p className="leading-relaxed">{claim.sourceDisagreement}</p>
              </div>
            </section>
          )}

          {/* Verified Live Source Citations */}
          <section className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-500">
                Live Web Sources ({safeSources.length})
              </h3>
              <span className="text-xs text-slate-400">
                {claim.liveSearchExecuted ? 'Verified via live web search' : 'Live search unavailable'}
              </span>
            </div>

            {safeSources.length > 0 ? (
              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {safeSources.map((src, idx) => (
                  <li key={idx} className="p-3 bg-white hover:bg-slate-50 transition-colors">
                    <a
                      href={src.safeHref!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start justify-between gap-3 group"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0F1E3D] group-hover:text-[#2563EB] transition-colors truncate">
                          {src.title}
                        </p>
                        <p className="text-xs text-slate-500 font-mono truncate mt-0.5">
                          {src.domain}
                          {src.publicationDate ? ` · Published ${src.publicationDate}` : ''}
                        </p>
                      </div>
                      <ExternalLink
                        className="w-4 h-4 text-slate-400 group-hover:text-[#2563EB] shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                {claim.searchError ||
                  'No authoritative public web sources were returned for this claim.'}
              </p>
            )}

            {claim.searchQueries.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-slate-400">
                  Live search queries executed
                </p>
                <p className="text-xs font-mono text-slate-600 leading-relaxed">
                  {claim.searchQueries.join('  ·  ')}
                </p>
              </div>
            )}
          </section>

          {reverifyError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
            >
              {reverifyError}
            </div>
          )}
        </div>

        {/* Sticky Panel Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-4 shrink-0">
          <button
            type="button"
            disabled={isReverifying}
            onClick={handleReverify}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0F1E3D] bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-60"
          >
            {isReverifying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{isReverifying ? 'Re-verifying live…' : 'Re-verify Claim Live'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0F1E3D] hover:bg-[#172B54] rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </aside>
    </div>
  );
};
