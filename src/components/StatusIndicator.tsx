import React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import type { ClaimStatus } from '../types/factCheck';
import { STATUS_CONFIG } from '../utils/formatting';

interface StatusIndicatorProps {
  status: ClaimStatus;
  size?: 'sm' | 'md';
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, size = 'sm' }) => {
  const cfg = STATUS_CONFIG[status];
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-4.5 h-4.5';

  const Icon =
    status === 'VERIFIED'
      ? CheckCircle2
      : status === 'INACCURATE'
        ? AlertTriangle
        : status === 'FALSE'
          ? XCircle
          : HelpCircle;

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${cfg.textClass} ${
        size === 'sm' ? 'text-xs' : 'text-sm'
      }`}
    >
      <Icon className={`${iconSize} shrink-0`} aria-hidden="true" />
      <span>{cfg.label}</span>
    </span>
  );
};
