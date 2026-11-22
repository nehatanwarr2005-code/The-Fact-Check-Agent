export type ClaimStatus = 'VERIFIED' | 'INACCURATE' | 'FALSE' | 'UNVERIFIED';

export type ClaimCategory =
  | 'Statistic'
  | 'Financial'
  | 'Date / Timeline'
  | 'Market Research'
  | 'Technical Spec'
  | 'Scientific'
  | 'Company / Product'
  | 'Comparison'
  | 'General Fact';

export interface SourceCitation {
  title: string;
  url: string;
  domain: string;
  publicationDate?: string | null;
  excerpt?: string | null;
}

export interface ExtractedClaim {
  id: string;
  pageNumber: number;
  additionalPages?: number[];
  originalClaim: string;
  category: ClaimCategory;
  extractedValues: string[];
  interpretation: string;
  documentDataPeriod?: string | null;
  documentPublicationDate?: string | null;
  suggestedSearchQueries?: string[];
}

export interface VerifiedClaim extends ExtractedClaim {
  status: ClaimStatus;
  evidenceSummary: string;
  supportingEvidence: string[];
  contradictoryEvidence: string[];
  explanation: string;
  correctedStatement: string | null;
  correctionSourceExcerpt?: string | null;
  originalValue?: string | null;
  correctedValue?: string | null;
  differenceSummary?: string | null;
  originalDataPeriod?: string | null;
  latestDataPeriod?: string | null;
  sourceDisagreement?: string | null;
  sources: SourceCitation[];
  searchQueries: string[];
  liveSearchExecuted: boolean;
  searchError?: string | null;
  lastVerifiedDate: string;
}

export interface ReportSummary {
  totalClaims: number;
  verified: number;
  inaccurate: number;
  falseCount: number;
  unverified: number;
  resolvedClaims?: number;
  verificationCoverage?: number;
  overallAccuracy: number | null;
  accuracyBasis: string;
}

export interface FactCheckReport {
  id: string;
  documentName: string;
  documentPublicationDate?: string | null;
  fileSizeBytes: number;
  pageCount: number;
  extractionMethod: 'text' | 'ocr' | 'hybrid';
  extractionNotes?: string | null;
  analysisDate: string;
  liveSearchAvailable: boolean;
  summary: ReportSummary;
  executiveSummary: string;
  recommendations: string[];
  claims: VerifiedClaim[];
}

export type ProcessingStageKey =
  | 'upload'
  | 'extract'
  | 'identify'
  | 'search'
  | 'compare'
  | 'report';

export type ProgressEvent =
  | {
      type: 'stage';
      stage: ProcessingStageKey;
      status: 'active' | 'completed' | 'error';
      detail: string;
    }
  | {
      type: 'claims_extracted';
      totalClaims: number;
      pageCount: number;
      extractionMethod: 'text' | 'ocr' | 'hybrid';
      extractionNotes?: string | null;
      claims: ExtractedClaim[];
    }
  | {
      type: 'claim_verified';
      index: number;
      total: number;
      claim: VerifiedClaim;
    }
  | {
      type: 'complete';
      report: FactCheckReport;
    }
  | {
      type: 'error';
      message: string;
      stage?: ProcessingStageKey;
    };
