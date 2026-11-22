import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  FileText,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import type { ProcessingStageKey, VerifiedClaim } from '../types/factCheck';
import { formatFileSize } from '../utils/formatting';
import { StatusIndicator } from './StatusIndicator';

export interface StageState {
  key: ProcessingStageKey;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  detail: string;
}

interface ProcessingViewProps {
  file: File;
  stages: StageState[];
  totalClaims: number | null;
  verifiedClaims: VerifiedClaim[];
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  file,
  stages,
  totalClaims,
  verifiedClaims,
  error,
  onCancel,
  onRetry,
}) => {
  const completedStages = stages.filter((s) => s.status === 'completed').length;
  const claimProgressRatio =
    totalClaims && totalClaims > 0 ? verifiedClaims.length / totalClaims : 0;

  // Deterministic progress strictly derived from completed real stages & completed claim verifications
  const overallPercent = error
    ? Math.round((completedStages / stages.length) * 100)
    : totalClaims && totalClaims > 0 && completedStages >= 3 && completedStages < 6
      ? Math.min(95, Math.round(45 + claimProgressRatio * 48))
      : Math.round((completedStages / stages.length) * 100);

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Document Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-[#0F1E3D] text-white flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold text-[#0F1E3D] truncate">
                {error ? 'Verification Interrupted' : 'Verifying Document Claims'}
              </h1>
              <p className="text-xs text-slate-500 font-mono tabular-nums truncate mt-0.5">
                {file.name} · {formatFileSize(file.size)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="font-mono text-sm font-semibold text-[#0F1E3D] tabular-nums">
              {overallPercent}%
            </span>
            {!error && (
              <button
                type="button"
                onClick={onCancel}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Deterministic Progress Bar */}
        <div className="h-1.5 w-full bg-slate-100">
          <div
            className={`h-full transition-all duration-300 ${
              error ? 'bg-red-600' : 'bg-[#2563EB]'
            }`}
            style={{ width: `${Math.max(4, overallPercent)}%` }}
          />
        </div>

        <div className="p-6 sm:p-8 space-y-8">
          {/* 6 Real-Time Stages */}
          <ol className="space-y-4" aria-label="Verification pipeline stages">
            {stages.map((stage, idx) => {
              const isActive = stage.status === 'active';
              const isDone = stage.status === 'completed';
              const isErr = stage.status === 'error';

              return (
                <li
                  key={stage.key}
                  className={`flex items-start gap-3.5 pb-4 ${
                    idx < stages.length - 1 ? 'border-b border-slate-100' : ''
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                    ) : isActive ? (
                      <Loader2
                        className="w-5 h-5 text-[#2563EB] animate-spin"
                        aria-hidden="true"
                      />
                    ) : isErr ? (
                      <AlertCircle className="w-5 h-5 text-red-600" aria-hidden="true" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-300" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <p
                        className={`text-sm font-semibold ${
                          isDone || isActive
                            ? 'text-[#0F1E3D]'
                            : isErr
                              ? 'text-red-700'
                              : 'text-slate-400'
                        }`}
                      >
                        {stage.label}
                      </p>
                      <span className="text-xs font-mono text-slate-400 tabular-nums shrink-0">
                        {isDone
                          ? 'Done'
                          : isActive
                            ? 'Running'
                            : isErr
                              ? 'Failed'
                              : 'Waiting'}
                      </span>
                    </div>
                    {stage.detail && (
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{stage.detail}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Live Claim Verification Stream */}
          {totalClaims !== null && totalClaims > 0 && (
            <div className="pt-6 border-t border-slate-200 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-display text-sm font-bold text-[#0F1E3D]">
                  Live Claim Verification Feed
                </h2>
                <span className="text-xs font-mono font-semibold text-[#2563EB] tabular-nums">
                  {verifiedClaims.length} of {totalClaims} verified
                </span>
              </div>

              {verifiedClaims.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Querying live Google Search sources for the first batch of extracted claims…
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {verifiedClaims.map((claim) => (
                    <div
                      key={claim.id}
                      className="px-4 py-3 flex items-start justify-between gap-4 bg-slate-50/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                          <span className="font-semibold text-[#0F1E3D]">{claim.id}</span>
                          <span aria-hidden="true">·</span>
                          <span>Page {claim.pageNumber}</span>
                          <span aria-hidden="true">·</span>
                          <span>{claim.sources.length} source(s)</span>
                        </div>
                        <p className="text-xs text-slate-700 mt-1 line-clamp-2">
                          {claim.originalClaim}
                        </p>
                      </div>
                      <div className="shrink-0 pt-0.5">
                        <StatusIndicator status={claim.status} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error & Retry Box */}
          {error && (
            <div
              role="alert"
              className="p-4 rounded-lg bg-red-50 border border-red-200 space-y-4"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-red-900">
                    Analysis could not be completed
                  </p>
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pl-8">
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F1E3D] hover:bg-[#172B54] rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Retry Analysis</span>
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  Choose Another PDF
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
