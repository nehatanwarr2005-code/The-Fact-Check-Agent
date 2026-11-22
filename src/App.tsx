/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClaimDetailDrawer } from './components/ClaimDetailDrawer';
import { LandingUploadView } from './components/LandingUploadView';
import { type ActiveScreen, Navbar } from './components/Navbar';
import { ProcessingView, type StageState } from './components/ProcessingView';
import { ReportPreviewView } from './components/ReportPreviewView';
import { ResultsDashboard } from './components/ResultsDashboard';
import type {
  FactCheckReport,
  ProcessingStageKey,
  ProgressEvent,
  VerifiedClaim,
} from './types/factCheck';
import {
  analyzePdfStream,
  fetchSamplePdfFile,
  reverifySingleClaimApi,
} from './utils/api';
import { recalculateSummary } from './utils/formatting';

const HISTORY_STORAGE_KEY = 'fact_check_agent_recent_reports_v1';
const MAX_SAVED_REPORTS = 10;

function createInitialStages(): StageState[] {
  return [
    { key: 'upload', label: 'Uploading PDF', status: 'active', detail: 'Sending PDF to verification server…' },
    { key: 'extract', label: 'Extracting document text', status: 'pending', detail: '' },
    { key: 'identify', label: 'Identifying factual claims', status: 'pending', detail: '' },
    { key: 'search', label: 'Searching live web sources', status: 'pending', detail: '' },
    { key: 'compare', label: 'Comparing evidence', status: 'pending', detail: '' },
    { key: 'report', label: 'Generating fact-check report', status: 'pending', detail: '' },
  ];
}

function loadSavedReports(): FactCheckReport[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FactCheckReport[]) : [];
  } catch {
    return [];
  }
}

function saveReports(reports: FactCheckReport[]): void {
  try {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(reports.slice(0, MAX_SAVED_REPORTS))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export default function App() {
  const [screen, setScreen] = useState<ActiveScreen>('landing');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeFile, setActiveFile] = useState<File | null>(null);
  const [landingError, setLandingError] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);

  // Processing stream state
  const [stages, setStages] = useState<StageState[]>(createInitialStages);
  const [totalClaimsToVerify, setTotalClaimsToVerify] = useState<number | null>(null);
  const [liveVerifiedClaims, setLiveVerifiedClaims] = useState<VerifiedClaim[]>([]);
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Completed report & history state
  const [currentReport, setCurrentReport] = useState<FactCheckReport | null>(null);
  const [recentReports, setRecentReports] = useState<FactCheckReport[]>(() => loadSavedReports());
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    saveReports(recentReports);
  }, [recentReports]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const persistReport = useCallback((report: FactCheckReport) => {
    setRecentReports((prev) => {
      const deduped = prev.filter((r) => r.id !== report.id);
      return [report, ...deduped].slice(0, MAX_SAVED_REPORTS);
    });
  }, []);

  const handleProgressEvent = useCallback(
    (event: ProgressEvent) => {
      if (event.type === 'stage') {
        setStages((prev) =>
          prev.map((s) =>
            s.key === event.stage
              ? { ...s, status: event.status, detail: event.detail }
              : s
          )
        );
      } else if (event.type === 'claims_extracted') {
        setTotalClaimsToVerify(event.totalClaims);
      } else if (event.type === 'claim_verified') {
        setLiveVerifiedClaims((prev) => {
          if (prev.some((c) => c.id === event.claim.id)) return prev;
          return [...prev, event.claim];
        });
        setStages((prev) =>
          prev.map((s) =>
            s.key === 'search' && s.status === 'active'
              ? {
                  ...s,
                  detail: `Verified ${event.index} of ${event.total} claim(s) against live web sources…`,
                }
              : s
          )
        );
      } else if (event.type === 'complete') {
        setCurrentReport(event.report);
        persistReport(event.report);
        setSelectedClaimId(null);
        setScreen('dashboard');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (event.type === 'error') {
        setProcessingError(event.message);
        setStages((prev) =>
          prev.map((s) =>
            s.status === 'active' || (event.stage && s.key === event.stage)
              ? { ...s, status: 'error' }
              : s
          )
        );
      }
    },
    [persistReport]
  );

  const startAnalysis = useCallback(
    async (file: File) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLandingError(null);
      setActiveFile(file);
      setSelectedFile(file);
      setStages(createInitialStages());
      setTotalClaimsToVerify(null);
      setLiveVerifiedClaims([]);
      setProcessingError(null);
      setScreen('processing');
      window.scrollTo({ top: 0, behavior: 'smooth' });

      try {
        await analyzePdfStream(file, handleProgressEvent, controller.signal);
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while verifying this document.';
        setProcessingError(message);
        setStages((prev) =>
          prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s))
        );
      }
    },
    [handleProgressEvent]
  );

  const handleRunSampleAnalysis = useCallback(async () => {
    setLandingError(null);
    setIsLoadingSample(true);
    try {
      const sampleFile = await fetchSamplePdfFile();
      setIsLoadingSample(false);
      await startAnalysis(sampleFile);
    } catch (err) {
      setIsLoadingSample(false);
      setLandingError(
        err instanceof Error ? err.message : 'Unable to load the sample verification PDF.'
      );
    }
  }, [startAnalysis]);

  const handleCancelProcessing = useCallback(() => {
    abortControllerRef.current?.abort();
    setProcessingError(null);
    setScreen('landing');
  }, []);

  const handleRetryProcessing = useCallback(() => {
    if (activeFile) {
      void startAnalysis(activeFile);
    } else {
      setScreen('landing');
    }
  }, [activeFile, startAnalysis]);

  const handleOpenSavedReport = useCallback((report: FactCheckReport) => {
    setCurrentReport(report);
    setSelectedClaimId(null);
    setScreen('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleDeleteSavedReport = useCallback(
    (id: string) => {
      setRecentReports((prev) => prev.filter((r) => r.id !== id));
      if (currentReport?.id === id) {
        setCurrentReport(null);
        setSelectedClaimId(null);
      }
    },
    [currentReport]
  );

  const handleReverifyClaim = useCallback(
    async (claim: VerifiedClaim) => {
      const updated = await reverifySingleClaimApi(claim);
      setCurrentReport((prev) => {
        if (!prev) return prev;
        const updatedClaims = prev.claims.map((c) => (c.id === updated.id ? updated : c));
        const updatedSummary = recalculateSummary(updatedClaims);
        const updatedReport: FactCheckReport = {
          ...prev,
          liveSearchAvailable:
            prev.liveSearchAvailable || updated.liveSearchExecuted,
          summary: updatedSummary,
          claims: updatedClaims,
        };
        persistReport(updatedReport);
        return updatedReport;
      });
    },
    [persistReport]
  );

  const handleScrollToSection = useCallback((sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleTriggerUploadFocus = useCallback(() => {
    if (screen !== 'landing') {
      setScreen('landing');
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 80);
    } else {
      fileInputRef.current?.click();
    }
  }, [screen]);

  const inspectedClaimIndex =
    currentReport && selectedClaimId
      ? currentReport.claims.findIndex((c) => c.id === selectedClaimId)
      : -1;
  const inspectedClaim =
    currentReport && inspectedClaimIndex >= 0
      ? currentReport.claims[inspectedClaimIndex]
      : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F1E3D]">
      <Navbar
        screen={screen}
        hasReport={Boolean(currentReport)}
        historyCount={recentReports.length}
        onNavigate={(target) => {
          setSelectedClaimId(null);
          setScreen(target);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onScrollToSection={handleScrollToSection}
        onTriggerUploadFocus={handleTriggerUploadFocus}
      />

      <div className="flex-1">
        {screen === 'landing' && (
          <LandingUploadView
            selectedFile={selectedFile}
            onSelectFile={(f) => {
              setLandingError(null);
              setSelectedFile(f);
            }}
            onStartAnalysis={startAnalysis}
            onRunSampleAnalysis={handleRunSampleAnalysis}
            isLoadingSample={isLoadingSample}
            externalError={landingError}
            recentReports={recentReports}
            onOpenReport={handleOpenSavedReport}
            onDeleteReport={handleDeleteSavedReport}
            fileInputRef={fileInputRef}
          />
        )}

        {screen === 'processing' && activeFile && (
          <ProcessingView
            file={activeFile}
            stages={stages}
            totalClaims={totalClaimsToVerify}
            verifiedClaims={liveVerifiedClaims}
            error={processingError}
            onCancel={handleCancelProcessing}
            onRetry={handleRetryProcessing}
          />
        )}

        {screen === 'dashboard' && currentReport && (
          <ResultsDashboard
            report={currentReport}
            onInspectClaim={(id) => setSelectedClaimId(id)}
            onOpenReportPreview={() => {
              setSelectedClaimId(null);
              setScreen('report');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onStartNewAudit={() => {
              setSelectedClaimId(null);
              setSelectedFile(null);
              setScreen('landing');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}

        {screen === 'report' && currentReport && (
          <ReportPreviewView
            report={currentReport}
            onBackToDashboard={() => {
              setScreen('dashboard');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
      </div>

      {/* Screen 4: Slide-over Detailed Claim Analysis Inspector */}
      {inspectedClaim && currentReport && (
        <ClaimDetailDrawer
          claim={inspectedClaim}
          currentIndex={inspectedClaimIndex}
          totalClaims={currentReport.claims.length}
          onClose={() => setSelectedClaimId(null)}
          onNavigate={(direction) => {
            const nextIdx =
              direction === 'prev' ? inspectedClaimIndex - 1 : inspectedClaimIndex + 1;
            const nextClaim = currentReport.claims[nextIdx];
            if (nextClaim) setSelectedClaimId(nextClaim.id);
          }}
          onReverify={handleReverifyClaim}
        />
      )}

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-slate-200 bg-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p className="font-medium text-[#0F1E3D]">
            The Fact-Check Agent — Don&apos;t Just Publish. Verify.
          </p>
          <p>
            Every factual correction is grounded in live web citations · Never publish unverified
            statistics
          </p>
        </div>
      </footer>
    </div>
  );
}
