import type { ClaimStatus, ReportSummary, VerifiedClaim } from '../types/factCheck';

export interface StatusVisualConfig {
  label: string;
  shortLabel: string;
  description: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  chartHex: string;
}

export const STATUS_CONFIG: Record<ClaimStatus, StatusVisualConfig> = {
  VERIFIED: {
    label: 'Verified as Accurate',
    shortLabel: 'Verified',
    description: 'Matches reliable, current, and relevant live web evidence.',
    textClass: 'text-emerald-700',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-200',
    chartHex: '#15803D',
  },
  INACCURATE: {
    label: 'Inaccurate',
    shortLabel: 'Inaccurate',
    description: 'Contains outdated, misleading, or partially incorrect information.',
    textClass: 'text-amber-700',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-200',
    chartHex: '#D97706',
  },
  FALSE: {
    label: 'False',
    shortLabel: 'False',
    description: 'Directly contradicted by reliable, authoritative evidence.',
    textClass: 'text-red-700',
    bgClass: 'bg-red-50',
    borderClass: 'border-red-200',
    chartHex: '#DC2626',
  },
  UNVERIFIED: {
    label: 'Unverified',
    shortLabel: 'Unverified',
    description: 'Insufficient public reliable evidence available to confirm or disprove.',
    textClass: 'text-slate-600',
    bgClass: 'bg-slate-100',
    borderClass: 'border-slate-200',
    chartHex: '#64748B',
  },
};

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDateShort(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

export function formatDateTime(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoDate;
  }
}

/**
 * Validates untrusted external URLs before placing them in <a href>.
 * Blocks javascript:, data:, vbscript:, and malformed URLs.
 */
export function getSafeHref(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export interface ResolvedSummaryMetrics {
  resolvedClaims: number;
  verificationCoverage: number;
  verifiedTrueShare: number | null;
  verifiedTrueShareLabel: string;
  metricBasis: string;
}

export function buildMetricBasis(
  totalClaims: number,
  verified: number,
  inaccurate: number,
  falseCount: number,
  unverified: number
): string {
  const resolvedClaims = verified + inaccurate + falseCount;
  const verificationCoverage =
    totalClaims > 0 ? Math.round((resolvedClaims / totalClaims) * 100) : 0;

  if (totalClaims === 0) {
    return 'No verifiable factual claims were extracted from this document';
  }
  if (resolvedClaims === 0) {
    return `Verified-True Share is N/A because 0 of ${totalClaims} total claims could be resolved with public live evidence (${unverified} remain unverified, not proven false; Verification Coverage: 0%)`;
  }
  return `Verified-True Share: ${verified} of ${resolvedClaims} resolved claims verified as accurate (${inaccurate} inaccurate, ${falseCount} false). ${unverified} of ${totalClaims} total claims remain unverified and are excluded rather than treated as false. Verification Coverage: ${verificationCoverage}% (${resolvedClaims} of ${totalClaims} claims resolved via live web evidence)`;
}

export function resolveSummaryMetrics(summary: ReportSummary): ResolvedSummaryMetrics {
  const resolvedClaims = summary.verified + summary.inaccurate + summary.falseCount;
  const totalClaims =
    summary.totalClaims > 0 ? summary.totalClaims : resolvedClaims + summary.unverified;

  const verificationCoverage =
    totalClaims > 0 ? Math.round((resolvedClaims / totalClaims) * 100) : 0;

  const verifiedTrueShare =
    resolvedClaims > 0 ? Math.round((summary.verified / resolvedClaims) * 100) : null;

  return {
    resolvedClaims,
    verificationCoverage,
    verifiedTrueShare,
    verifiedTrueShareLabel: verifiedTrueShare === null ? 'N/A' : `${verifiedTrueShare}%`,
    metricBasis: buildMetricBasis(
      totalClaims,
      summary.verified,
      summary.inaccurate,
      summary.falseCount,
      summary.unverified
    ),
  };
}

export function recalculateSummary(claims: VerifiedClaim[]): ReportSummary {
  const totalClaims = claims.length;
  const verified = claims.filter((c) => c.status === 'VERIFIED').length;
  const inaccurate = claims.filter((c) => c.status === 'INACCURATE').length;
  const falseCount = claims.filter((c) => c.status === 'FALSE').length;
  const unverified = claims.filter((c) => c.status === 'UNVERIFIED').length;

  const resolvedClaims = verified + inaccurate + falseCount;
  const verificationCoverage =
    totalClaims > 0 ? Math.round((resolvedClaims / totalClaims) * 100) : 0;
  const overallAccuracy =
    resolvedClaims > 0 ? Math.round((verified / resolvedClaims) * 100) : null;

  return {
    totalClaims,
    verified,
    inaccurate,
    falseCount,
    unverified,
    resolvedClaims,
    verificationCoverage,
    overallAccuracy,
    accuracyBasis: buildMetricBasis(totalClaims, verified, inaccurate, falseCount, unverified),
  };
}
