import { ThinkingLevel, Type } from '@google/genai';
import {
  GEMINI_FALLBACK_MODEL,
  GEMINI_MODEL,
  getGeminiClient,
  isQuotaOrRateLimitError,
  withRetry,
  withTimeout,
} from './geminiClient.ts';
import {
  buildFallbackQueries,
  isGoogleNewsRedirectUrl,
  type LiveEvidenceItem,
  type OfficialInstitution,
  queryOfficialInstitution,
  scoreAuthority,
  searchLiveWebEvidence,
  validateSourceUrl,
} from './liveWebSearch.ts';
import type {
  ClaimCategory,
  ClaimStatus,
  ExtractedClaim,
  ReportSummary,
  SourceCitation,
  VerifiedClaim,
} from '../src/types/factCheck.ts';

const MAX_CLAIMS_TO_VERIFY = 18;

const VALID_CATEGORIES = new Set<ClaimCategory>([
  'Statistic',
  'Financial',
  'Date / Timeline',
  'Market Research',
  'Technical Spec',
  'Scientific',
  'Company / Product',
  'Comparison',
  'General Fact',
]);

const VALID_STATUSES = new Set<ClaimStatus>(['VERIFIED', 'INACCURATE', 'FALSE', 'UNVERIFIED']);

// Tracks short cooldown when Gemini built-in Google Search grounding hits a hard 429 quota error
// so subsequent claims immediately route to live web retrieval instead of stalling.
let groundingCooldownUntil = 0;

// Tracks short cooldown when primary GEMINI_MODEL hits a per-minute 429 rate limit so subsequent
// claims immediately route to GEMINI_FALLBACK_MODEL instead of burning retries on the throttled model.
let primaryModelCooldownUntil = 0;

export function sanitizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return 'web';
  }
}

function extractBalancedJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const startIdx = candidate.indexOf('{');
    const endIdx = candidate.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      return JSON.parse(candidate.slice(startIdx, endIdx + 1));
    }
    throw new Error('Failed to parse structured verification JSON from AI response.');
  }
}

async function generateWithModelFallback(
  params: {
    contents: string;
    systemInstruction: string;
    responseMimeType?: string;
    responseSchema?: unknown;
    useLowThinking?: boolean;
  }
) {
  const ai = getGeminiClient();

  const runModel = (model: string, applyThinking: boolean) =>
    withTimeout(
      withRetry(() =>
        ai.models.generateContent({
          model,
          contents: params.contents,
          config: {
            ...(applyThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            systemInstruction: params.systemInstruction,
            ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {}),
            ...(params.responseSchema ? { responseSchema: params.responseSchema as never } : {}),
          },
        })
      ),
      32_000,
      `Gemini ${model}`
    );

  // If primary model recently hit an RPM 429 or stall, route directly to fallback during cooldown
  if (Date.now() < primaryModelCooldownUntil) {
    try {
      return await runModel(GEMINI_FALLBACK_MODEL, false);
    } catch (fallbackErr) {
      if (isQuotaOrRateLimitError(fallbackErr)) {
        primaryModelCooldownUntil = 0;
        return await runModel(GEMINI_MODEL, Boolean(params.useLowThinking));
      }
      throw fallbackErr;
    }
  }

  try {
    return await runModel(GEMINI_MODEL, Boolean(params.useLowThinking));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTransientTimeout = /timed out|503|504|unavailable|overloaded/i.test(errMsg);
    if (isQuotaOrRateLimitError(err) || isTransientTimeout) {
      primaryModelCooldownUntil = Date.now() + 25_000;
      console.warn(
        `[factChecker] ${GEMINI_MODEL} hit ${isTransientTimeout ? 'timeout/5xx' : 'quota/rate limit'}; switching to ${GEMINI_FALLBACK_MODEL} (25s primary cooldown):`,
        errMsg.slice(0, 180)
      );
      return await runModel(GEMINI_FALLBACK_MODEL, false);
    }
    throw err;
  }
}

export interface DocumentClaimExtractionResult {
  claims: ExtractedClaim[];
  documentPublicationDate: string | null;
}

export async function extractClaimsFromDocument(
  combinedText: string,
  pageCount: number
): Promise<DocumentClaimExtractionResult> {
  const prompt = `Analyze the following PDF document text (which spans ${pageCount} page(s) and includes [Page N] markers).
1) Identify the publication date of the uploaded document if stated anywhere on the cover, header, footer, or opening section (e.g., "March 2025", "2024-11-15", "November 2026", or null if not stated).
2) Extract all distinct, independently verifiable factual claims.

Focus especially on:
- Numerical statistics, counts, percentages, thresholds ("fewer than", "more than"), and growth rates
- Financial figures and monetary claims
- Dates, founding years, and historical timelines
- Market research statistics and market shares
- Technical specifications and physical measurements
- Scientific and factual statements
- Company, product, and milestone claims
- Comparative and performance claims
- Proprietary or internal survey statistics (extract them too so the verifier can properly flag them as UNVERIFIED rather than skipping them)

Rules:
1. Extract each factual claim separately as a clear, self-contained statement.
2. Preserve the original wording from the PDF closely in "originalClaim".
3. Always assign the accurate integer "pageNumber" based on the nearest preceding [Page N] marker.
4. If the exact same claim or statistic is repeated on another page, deduplicate it into one entry and list the extra page numbers in "additionalPages".
5. Extract key numbers, units, percentages, and dates into "extractedValues".
6. Provide 2 concise, neutral "suggestedSearchQueries" optimized for verifying the claim via authoritative institutional sources (NASA, ITU, UN, World Bank, IMF, WHO, IEA, IRENA, official government sources).
   - Do NOT copy potentially false numbers or wrong locations/attributes into neutral search queries (e.g., use "India official capital city" instead of "Mumbai capital of India"; use "Mount Everest location country border" instead of "Mount Everest entirely in India"; use "Pluto dwarf planet classification IAU NASA" instead of "Pluto ninth planet"; use "Eiffel Tower height meters" instead of "Eiffel Tower 450 meters").
   - For simple geographical, political, or scientific claims, include one concise canonical entity name query (e.g., "Mount Everest", "India", "Pluto") or entity + factual attribute query so encyclopedic and official agency pages match directly.
   - For global statistics, use official agency names and canonical statistical terms/synonyms + recent years (e.g., "IEA global electric car sales 2025", "IRENA global installed renewable energy capacity GW 2025", "UN World Bank world population 2025 2026", "ITU Facts and Figures global internet users 2026").
   - For NEGATIVE or THRESHOLD claims (e.g., "fewer than 1 billion people remain without Internet access", "never exceeded X", "less than Y%"), search for BOTH the asserted concept AND the actual opposing/official statistic (e.g., "ITU Facts and Figures global offline population 2024 2025 2026" and "people without internet access worldwide ITU").
7. Ignore pure opinions, generic marketing slogans with no factual content, headers/footers, and table of contents entries.
8. Return at most ${MAX_CLAIMS_TO_VERIFY} highest-priority verifiable claims, ordered by page number.

DOCUMENT TEXT:
${combinedText}`;

  const response = await generateWithModelFallback({
    contents: prompt,
    useLowThinking: true,
    systemInstruction:
      'You are an expert forensic editor and fact-checking analyst. Extract the document publication date (if stated) and atomic, verifiable factual claims with exact page attribution and zero fabrication.',
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        documentPublicationDate: {
          type: Type.STRING,
          description:
            'Publication date or month/year stated in the PDF (e.g. "2025-03-15", "October 2025", "2024"), or empty string if not stated in the document.',
        },
        claims: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              pageNumber: {
                type: Type.INTEGER,
                description: 'Primary page number where the claim appears (1-indexed).',
              },
              additionalPages: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
                description: 'Other page numbers if this exact claim is repeated.',
              },
              originalClaim: {
                type: Type.STRING,
                description: 'Verbatim or near-verbatim claim from the document.',
              },
              category: {
                type: Type.STRING,
                description:
                  'One of: Statistic, Financial, Date / Timeline, Market Research, Technical Spec, Scientific, Company / Product, Comparison, General Fact',
              },
              extractedValues: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Key numbers, percentages, currencies, units, or dates mentioned.',
              },
              interpretation: {
                type: Type.STRING,
                description: 'Concise clarification of what exact factual assertion is being tested.',
              },
              documentDataPeriod: {
                type: Type.STRING,
                description:
                  'Time period stated or implied by the PDF (e.g., "2024", "Since 2024", "Current / Present", "December 2015").',
              },
              suggestedSearchQueries: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  '2 concise, neutral live-web search queries targeting official sources and, for negative/threshold claims, both the asserted concept and the actual opposing statistic.',
              },
            },
            required: [
              'pageNumber',
              'originalClaim',
              'category',
              'extractedValues',
              'interpretation',
            ],
          },
        },
      },
      required: ['claims'],
    },
  });

  const rawText = (response.text ?? '').trim();
  const parsed = JSON.parse(rawText || '{"claims":[]}') as {
    documentPublicationDate?: string;
    claims?: Array<{
      pageNumber?: number;
      additionalPages?: number[];
      originalClaim?: string;
      category?: string;
      extractedValues?: string[];
      interpretation?: string;
      documentDataPeriod?: string;
      suggestedSearchQueries?: string[];
    }>;
  };

  const documentPublicationDate =
    typeof parsed.documentPublicationDate === 'string' &&
    parsed.documentPublicationDate.trim().length >= 4 &&
    !/^(null|none|unknown|not specified|n\/a)$/i.test(parsed.documentPublicationDate.trim())
      ? parsed.documentPublicationDate.trim().slice(0, 80)
      : null;

  const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : [];

  const claims = rawClaims
    .filter((c) => typeof c.originalClaim === 'string' && c.originalClaim.trim().length > 6)
    .slice(0, MAX_CLAIMS_TO_VERIFY)
    .map((c, idx): ExtractedClaim => {
      const pageNum = Math.max(1, Math.min(pageCount, Math.round(Number(c.pageNumber) || 1)));
      const extraPages = Array.isArray(c.additionalPages)
        ? [
            ...new Set(
              c.additionalPages
                .map((n) => Math.round(Number(n)))
                .filter((n) => n >= 1 && n <= pageCount && n !== pageNum)
            ),
          ]
        : [];
      const category = VALID_CATEGORIES.has(c.category as ClaimCategory)
        ? (c.category as ClaimCategory)
        : 'General Fact';

      return {
        id: `CLM-${String(idx + 1).padStart(2, '0')}`,
        pageNumber: pageNum,
        additionalPages: extraPages.length > 0 ? extraPages : undefined,
        originalClaim: c.originalClaim!.trim(),
        category,
        extractedValues: Array.isArray(c.extractedValues)
          ? c.extractedValues.filter((v) => typeof v === 'string' && v.trim().length > 0)
          : [],
        interpretation:
          typeof c.interpretation === 'string' && c.interpretation.trim()
            ? c.interpretation.trim()
            : 'Verifiable factual assertion extracted from the document.',
        documentDataPeriod:
          typeof c.documentDataPeriod === 'string' && c.documentDataPeriod.trim()
            ? c.documentDataPeriod.trim()
            : null,
        documentPublicationDate,
        suggestedSearchQueries: Array.isArray(c.suggestedSearchQueries)
          ? c.suggestedSearchQueries
              .filter((q): q is string => typeof q === 'string' && q.trim().length >= 3)
              .map((q) => q.trim())
              .slice(0, 3)
          : undefined,
      };
    });

  return { claims, documentPublicationDate };
}

interface RawGroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

interface RawGroundingMetadata {
  groundingChunks?: RawGroundingChunk[];
  webSearchQueries?: string[];
}

function getAuthorityTierLabel(score: number): string {
  if (score >= 98) return 'Tier 1 (Official Government / Standards / Space Agency / IMF / World Bank / ITU / WHO / UN / IEA / IRENA)';
  if (score >= 92) return 'Tier 2 (Intergovernmental / Official Protocol / Geographical / Peer-Reviewed Research)';
  if (score >= 84) return 'Tier 3 (Established Reference / Wire Service)';
  return 'Tier 4 (General News)';
}

/**
 * Normalizes typography and whitespace while keeping a character-index map back to the raw string
 * so any match can be sliced verbatim from the exact retrieved source text.
 */
function normalizeWithIndexMap(raw: string): { norm: string; indexMap: number[] } {
  let norm = '';
  const indexMap: number[] = [];
  let lastWasSpace = true;

  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (ch === '\u2018' || ch === '\u2019') ch = "'";
    else if (ch === '\u201C' || ch === '\u201D') ch = '"';
    else if (ch === '\u2013' || ch === '\u2014') ch = '-';
    else if (ch === '\u00A0') ch = ' ';

    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        norm += ' ';
        indexMap.push(i);
        lastWasSpace = true;
      }
    } else {
      norm += ch.toLowerCase();
      indexMap.push(i);
      lastWasSpace = false;
    }
  }

  if (norm.endsWith(' ')) {
    norm = norm.slice(0, -1);
    indexMap.pop();
  }
  return { norm, indexMap };
}

/**
 * Checks whether `candidate` appears verbatim (allowing only trivial whitespace/smart-quote
 * normalization) inside `snippet`, returning the exact unmodified slice from `snippet`.
 */
function findVerbatimMatchInSnippet(candidate: string, snippet: string): string | null {
  const cleanedCandidate = candidate
    .trim()
    .replace(/^["'\u201C\u2018.…\s]+|["'\u201D\u2019\s]+$/g, '')
    .replace(/(\.{3}|…)$/g, '')
    .trim();

  if (cleanedCandidate.length < 18) return null;

  const { norm: normCand } = normalizeWithIndexMap(cleanedCandidate);
  if (normCand.length < 18) return null;

  const { norm: normSnip, indexMap } = normalizeWithIndexMap(snippet);
  const pos = normSnip.indexOf(normCand);
  if (pos === -1) return null;

  const origStart = indexMap[pos];
  const origEnd = indexMap[pos + normCand.length - 1];
  if (origStart === undefined || origEnd === undefined || origEnd < origStart) return null;

  return snippet.slice(origStart, origEnd + 1).trim();
}

const EXCERPT_STOP_WORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'were', 'been', 'will', 'would', 'could',
  'about', 'their', 'there', 'which', 'where', 'while', 'under', 'over', 'into',
  'than', 'then', 'also', 'more', 'most', 'some', 'such', 'only', 'very', 'data',
  'claim', 'states', 'stated', 'figure', 'figures', 'according', 'source', 'report',
]);

/**
 * Programmatically extracts the best-matching 1-2 verbatim sentences directly from retrieved
 * source snippets when the AI model paraphrased or omitted `correctionSourceExcerpt`.
 */
function extractBestVerbatimExcerpt(fullSnippets: string[], referenceText: string): string | null {
  if (fullSnippets.length === 0) return null;

  const refNumbers = new Set(
    (referenceText.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).map((n) => n.replace(/,/g, ''))
  );
  const refWords = new Set(
    (referenceText.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
      (w) => !EXCERPT_STOP_WORDS.has(w)
    )
  );

  let bestScore = -1;
  let bestText: string | null = null;

  for (let sIdx = 0; sIdx < fullSnippets.length; sIdx++) {
    const snippet = fullSnippets[sIdx]?.trim();
    if (!snippet || snippet.length < 20) continue;

    // Split on true sentence boundaries without breaking decimal numbers (e.g. 5.8, 3.91)
    const sentences = snippet
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20);

    const units = sentences.length > 0 ? sentences : [snippet];

    for (let uIdx = 0; uIdx < units.length; uIdx++) {
      const unit = units[uIdx];
      const unitLower = unit.toLowerCase();
      let score = sIdx === 0 ? 4 : Math.max(0, 3 - sIdx);

      const unitNumbers = new Set(
        (unit.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).map((n) => n.replace(/,/g, ''))
      );
      for (const num of refNumbers) {
        if (unitNumbers.has(num)) score += 6;
      }

      for (const word of refWords) {
        if (unitLower.includes(word)) score += 2;
      }

      if (/\b(revised|estimate|billion|trillion|million|per cent|percent|gdp|official|mean|capital|border|between|dwarf planet|reclassified|located|capacity|gw|gigawatts|electric|sales|population|founded|incorporated|boils|boiling|100|21 million|max_money)\b/i.test(unit)) {
        score += 2;
      }

      // Penalize tangential mentions (e.g. base-camp-only trivia or expedition logistics)
      if (/\b(base camp|expedition|climbing permits)\b/i.test(unit) && !/\b(border|between|nepal|china|tibet)\b/i.test(unit)) {
        score -= 4;
      }

      if (score > bestScore) {
        bestScore = score;
        // Include an immediately adjacent sentence from the same source if it also matches and stays readable
        let combined = unit;
        if (uIdx + 1 < units.length) {
          const next = units[uIdx + 1];
          const nextMatchesNumber = [...refNumbers].some((n) => next.replace(/,/g, '').includes(n));
          const nextMatchesWord = [...refWords].some((w) => next.toLowerCase().includes(w));
          if ((nextMatchesNumber || nextMatchesWord) && combined.length + 1 + next.length <= 300) {
            combined = `${combined} ${next}`;
          }
        }
        bestText = combined;
      }
    }
  }

  if (!bestText) return null;
  if (bestText.length <= 320) return bestText;

  // Trim strictly along an exact substring boundary (sentence, semicolon, or word) without inventing text
  const cutArea = bestText.slice(0, 310);
  const lastPeriod = cutArea.lastIndexOf('. ');
  const lastSemi = cutArea.lastIndexOf(';');
  const lastSpace = cutArea.lastIndexOf(' ');
  const cutAt =
    lastPeriod >= 140 ? lastPeriod + 1 : lastSemi >= 140 ? lastSemi : lastSpace >= 140 ? lastSpace : 310;
  return bestText.slice(0, cutAt).trim();
}

/**
 * Validates that a verbatim excerpt actually provides direct topical support for the claim/correction
 * (not an unrelated tangent such as base-camp trivia when checking a mountain's international border).
 */
function excerptDirectlySupportsReference(excerpt: string, referenceText: string): boolean {
  const excerptLower = excerpt.toLowerCase();
  const refNumbers = (referenceText.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).map((n) => n.replace(/,/g, ''));
  const refWords = [
    ...new Set(
      (referenceText.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !EXCERPT_STOP_WORDS.has(w))
    ),
  ];

  let hits = 0;
  for (const num of refNumbers) {
    if (excerpt.replace(/,/g, '').includes(num)) hits += 2;
  }
  for (const word of refWords) {
    if (excerptLower.includes(word)) hits += 1;
  }

  // Reject base-camp-only snippets when verifying border/country claims
  if (/\bbase camp\b/i.test(excerptLower) && !/\b(border|between|tibet|china)\b/i.test(excerptLower)) {
    return false;
  }

  return hits >= 2;
}

/**
 * Guarantees that `correctionSourceExcerpt` is ALWAYS a literal verbatim substring of an
 * actual retrieved cited source snippet that directly supports the claim/correction —
 * never an AI-generated paraphrase or unrelated tangent.
 */
function resolveVerbatimCorrectionExcerpt(
  candidate: string | null,
  fullSnippets: string[],
  referenceText: string
): string | null {
  if (fullSnippets.length === 0) {
    return null;
  }

  if (candidate) {
    for (const snippet of fullSnippets) {
      const exactMatch = findVerbatimMatchInSnippet(candidate, snippet);
      if (exactMatch && excerptDirectlySupportsReference(exactMatch, referenceText)) {
        if (exactMatch.length <= 340) return exactMatch;
        const cutArea = exactMatch.slice(0, 330);
        const lastPeriod = cutArea.lastIndexOf('. ');
        const lastSemi = cutArea.lastIndexOf(';');
        const cutAt = lastPeriod >= 140 ? lastPeriod + 1 : lastSemi >= 140 ? lastSemi : 330;
        return exactMatch.slice(0, cutAt).trim();
      }
    }
    console.info(
      '[factChecker] Discarded non-verbatim or tangential correctionSourceExcerpt; substituting best directly-supporting verbatim source sentence.'
    );
  }

  return extractBestVerbatimExcerpt(fullSnippets, referenceText);
}

function buildVerificationInstructions(claim: ExtractedClaim, todayIso: string): string {
  return `Today's date is ${todayIso}.
Verify the following claim extracted from a PDF document against authoritative live web evidence.

CLAIM TO VERIFY:
- Claim ID: ${claim.id}
- Page Number: ${claim.pageNumber}
- Category: ${claim.category}
- Verbatim Claim: "${claim.originalClaim}"
- Extracted Values: ${claim.extractedValues.length > 0 ? claim.extractedValues.join(', ') : 'None'}
- Document Reference Period: ${claim.documentDataPeriod ?? 'Not specified'}
- Uploaded Document Publication Date: ${claim.documentPublicationDate ?? 'Not specified in document'}
- Interpretation: ${claim.interpretation}

MANDATORY VERIFICATION RULES:
1. NEVER assume the PDF claim is true. Strictly prioritize Tier 1 & Tier 2 official institutional sources — NASA / ESA / IAU (astronomy & planetary classification), ITU (global internet & offline connectivity), UN / World Bank / US Census (world population & official country facts), IMF / World Bank (GDP & macroeconomics), IEA (global electric vehicle sales & energy), IRENA (global installed renewable energy capacity), WHO (global health), .gov websites, and peer-reviewed journals — over Wikipedia or general news whenever official evidence is available.
2. NEVER fabricate statistics, replacement figures, publication dates, source excerpts, or source URLs. NEVER claim that a source supports a statement unless you have verified that the retrieved "Excerpt:" of that exact source actually states it.
3. Classify strictly into one of four statuses:
   - "VERIFIED": Retrieved reliable, current, and relevant evidence supports the claim (or the claim accurately states an explicitly dated historical estimate published prior to any later revision).
   - "INACCURATE": Contains outdated data presented as current/today (where the asserted figure WAS approximately valid during an earlier reference period), a legitimate earlier official estimate that was subsequently revised in a newer publication, imprecise figures, or incorrect reference periods. Explicitly identify BOTH originalDataPeriod (including the earlier year/era when the figure was valid if shown in retrieved evidence) and latestDataPeriod.
   - "FALSE": Reliable authoritative evidence directly contradicts the core factual claim and the asserted fact/figure was NOT a valid historical figure for the stated concept in an earlier period (for example: wrong capital city such as claiming Mumbai is India's capital; wrong geographic location such as claiming Mount Everest lies entirely within India; superseded scientific classification presented as current fact such as claiming Pluto is the ninth planet after the 2006 IAU reclassification to dwarf planet; impossible threshold such as claiming fewer than 1 billion people remain without Internet access since 2024; wrong founding year/location; wrong physical measurement; fabricated percentage).
   - "UNVERIFIED": Insufficient reliable public evidence exists in the retrieved sources to confirm or disprove the claim (for example, confidential internal company surveys or private client figures). NEVER guess or classify a claim as FALSE solely because no public source confirms it.
4. CRITICAL RULE — OUTDATED HISTORICAL FIGURES VS. FALSE CLAIMS:
   - NEVER classify an outdated historical statistic as "FALSE" if the retrieved time series or institutional records show that the figure was approximately valid during an earlier reference period!
   - Examples that MUST be classified "INACCURATE" (NOT "FALSE"):
     * Presenting an earlier world population figure (e.g., ~7.1 billion from ~2013 or ~7.8 billion from ~2020) as "current" when the latest UN / World Bank estimate is ~8.22 billion.
     * Presenting an earlier global Internet user count (e.g., ~5.3 billion from ~2022–2023) as "today" when ITU Facts and Figures 2026 reports ~6.3 billion users in 2026.
     * Presenting an earlier global annual EV sales figure (e.g., ~10 million from 2022) as "current" when IEA reports over 20 million (~21.2 million) in 2025.
     * Presenting an earlier global installed renewable capacity figure (e.g., ~3,372 GW from 2022) as "current" when IRENA reports ~5,155 GW at the end of 2025.
     * Citing a legitimate pre-revision official estimate (e.g., ITU's initial 2024 estimate of 5.5 billion / 68% online users later revised in ITU Facts and Figures 2025 to 5.8 billion / 71%, or 2.6B offline revised to 2.3B).
   - In all such cases, classify as "INACCURATE", state clearly that the PDF figure reflects an earlier reference period or pre-revision official estimate, and provide the latest verified official figure, reference period, and source.
   - When Uploaded Document Publication Date is known, explicitly consider whether the claim was already outdated at the time the document was published versus superseded by newer official data published afterward.
5. STRICT NUMERICAL COMPARABILITY & COMPLETE ATTRIBUTION:
   - Original and corrected figures MUST refer to the SAME year/period (or explicitly note any period shift or revision), unit, geographical scope (e.g., global vs. single-country), and statistical definition (e.g., nominal GDP in current USD vs. PPP GDP; installed renewable capacity in GW vs. generation share; battery + plug-in hybrid electric car sales; individuals using the Internet vs. offline population).
   - Whenever status is INACCURATE or FALSE, "correctedStatement" and "correctedValue" MUST explicitly specify: (a) exact authoritative source organization, (b) exact reference year (and revision publication year if revised), (c) exact numerical figure and unit (or exact verified factual entity), and (d) exact statistical definition and geographic scope.
   - NEVER compare incompatible statistics. If retrieved evidence only covers a different scope or metric without a matching figure, do NOT calculate a numerical delta from incompatible statistics.
6. Separate supporting evidence cleanly from contradictory evidence in "supportingEvidence" and "contradictoryEvidence". If reliable sources disagree or an agency revised an earlier figure, disclose it clearly in "sourceDisagreement" when helpful.
7. STRICT SOURCE ATTRIBUTION & LITERAL VERBATIM EXCERPT:
   - NEVER write "According to NASA..." (or attribute a correction to ITU, IMF, World Bank, WHO, UN, IEA, or IRENA) unless an official source from that exact organization (or official dataset publishing that agency's data) is cited in "citedSourceIndices" AND its retrieved "Excerpt:" directly supports the correction. Do NOT cite Wikipedia as primary evidence when an official source in the retrieved evidence directly establishes the fact!
   - Whenever status is INACCURATE or FALSE, every number, percentage, date, measurement, entity, or factual replacement in "correctedStatement", "correctedValue", and "differenceSummary" MUST be directly supported by the text/excerpts of the source(s) you cite in "citedSourceIndices".
   - For "correctionSourceExcerpt", you MUST copy a 1–2 sentence substring CHARACTER-FOR-CHARACTER VERBATIM from one of the cited source's "Excerpt:" blocks (preferring the highest-authority official source) that directly proves the verdict/correction (or set null if VERIFIED/UNVERIFIED). NEVER paraphrase, summarize, or alter wording inside "correctionSourceExcerpt".

Return ONLY a single valid JSON object (no surrounding markdown prose) with these exact keys:
{
  "status": "VERIFIED" | "INACCURATE" | "FALSE" | "UNVERIFIED",
  "evidenceSummary": "1-2 sentence concise summary of the live web evidence found.",
  "supportingEvidence": ["bullet string of supporting facts from live sources, or empty array"],
  "contradictoryEvidence": ["bullet string of contradictory facts from live sources, or empty array"],
  "explanation": "Clear 2-4 sentence explanation of why this exact status was assigned, distinguishing outdated historical figures/revisions (INACCURATE) from directly contradicted non-historical falsehoods (FALSE), and considering document publication date where applicable.",
  "correctedStatement": "Accurate replacement statement directly supported by the cited source(s), explicitly stating exact source, reference year (and revision year if revised), numerical figure/fact, unit, and statistical definition, or null if VERIFIED or UNVERIFIED.",
  "correctionSourceExcerpt": "Exact character-for-character verbatim quote copied directly from a cited source Excerpt supporting the correction (NEVER paraphrased), or null if VERIFIED or UNVERIFIED.",
  "originalValue": "Short figure/fact from PDF including unit/period (e.g. 'Approx. 7.8 billion (presented as current)') or null",
  "correctedValue": "Short verified figure/fact with exact source, year/revision, unit, and statistical definition (e.g. '8.22 billion global population in 2025 (World Bank / UN); ~7.86 billion was valid in 2020') or null",
  "differenceSummary": "Short comparable delta noting any revision or newer reporting period (e.g. 'Outdated by ~5 years; 2025 population is ~0.42 billion higher than 7.8 billion') or null if not directly comparable",
  "originalDataPeriod": "Reference period of PDF figure (e.g. 'Presented as current (reflects ~2020 data)') or null",
  "latestDataPeriod": "Reference period and revision year of verified evidence (e.g. '2025 (World Bank / UN)') or null",
  "sourcePublicationDate": "Publication date or year of primary verified source (e.g. '2026-11-03' or '2025') or null",
  "sourceDisagreement": "Description of any conflict among authoritative sources or historical-to-revised estimate change, or null",
  "citedSourceIndices": [1, 2]
}`;
}

/**
 * Primary live web verification path: Gemini built-in Google Search Grounding.
 * Returns null if grounding is quota-limited or returns zero grounded web chunks so the
 * direct live web retrieval pipeline can seamlessly verify the claim.
 */
async function tryGeminiGoogleSearchGrounding(
  claim: ExtractedClaim,
  todayIso: string
): Promise<{ claim: VerifiedClaim } | { reason: string }> {
  if (Date.now() < groundingCooldownUntil) {
    return { reason: 'Google Search grounding cooldown active after quota limit; using direct live web search.' };
  }

  const ai = getGeminiClient();
  const prompt = `${buildVerificationInstructions(claim, todayIso)}\n\nUse Google Search right now to retrieve live authoritative web sources before answering.`;

  const modelsToTry = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  let lastErrorMsg = '';

  for (const model of modelsToTry) {
    try {
      const response = await withTimeout(
        withRetry(
          () =>
            ai.models.generateContent({
              model,
              contents: prompt,
              config: {
                ...(model === GEMINI_MODEL
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
                systemInstruction:
                  'You are a rigorous investigative fact-checker. You MUST invoke Google Search grounding to verify every claim against live authoritative sources. Output strictly valid JSON.',
                tools: [{ googleSearch: {} }],
              },
            }),
          { maxAttempts: 1, baseDelayMs: 500 }
        ),
        16_000,
        `Google Search grounding (${model})`
      );

      const candidate = response.candidates?.[0];
      const grounding = candidate?.groundingMetadata as RawGroundingMetadata | undefined;
      const rawChunks = Array.isArray(grounding?.groundingChunks) ? grounding.groundingChunks : [];
      const searchQueries = Array.isArray(grounding?.webSearchQueries)
        ? grounding.webSearchQueries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        : [];

      const seenUrls = new Set<string>();
      const candidateSources: SourceCitation[] = [];

      for (const chunk of rawChunks) {
        const safeUrl = sanitizeHttpUrl(chunk?.web?.uri);
        if (!safeUrl || isGoogleNewsRedirectUrl(safeUrl) || seenUrls.has(safeUrl)) continue;
        seenUrls.add(safeUrl);
        const rawTitle =
          typeof chunk?.web?.title === 'string' && chunk.web.title.trim()
            ? chunk.web.title.trim()
            : extractDomain(safeUrl);
        candidateSources.push({
          title: rawTitle,
          url: safeUrl,
          domain: extractDomain(safeUrl),
        });
      }

      const livenessChecks = await Promise.all(
        candidateSources.map(async (src) => ({ src, ok: await validateSourceUrl(src.url) }))
      );
      const verifiedSources = livenessChecks.filter((r) => r.ok).map((r) => r.src);

      const rawText = (response.text ?? '').trim();

      if (verifiedSources.length === 0) {
        console.warn(
          `[factChecker] Google Search grounding (${model}) returned 0 source URLs for ${claim.id} (queries: ${searchQueries.length}). Falling back to direct live web search.`
        );
        return { reason: 'Google Search grounding returned zero web source URLs.' };
      }

      if (!rawText) {
        return { reason: 'Google Search grounding returned an empty response.' };
      }

      const parsed = extractBalancedJson(rawText) as Record<string, unknown>;
      const verified = assembleVerifiedClaim(
        claim,
        parsed,
        verifiedSources,
        searchQueries,
        todayIso,
        true,
        []
      );
      console.info(
        `[factChecker] ${claim.id} verified via Gemini Google Search grounding (${model}) -> ${verified.status} (${verified.sources.length} sources)`
      );
      return { claim: verified };
    } catch (err) {
      lastErrorMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[factChecker] Google Search grounding failed on ${model} for ${claim.id}:`,
        lastErrorMsg.slice(0, 220)
      );
      if (isQuotaOrRateLimitError(err)) {
        // Try fallback model; if both hit quota, activate a 2-minute cooldown
        continue;
      }
      break;
    }
  }

  if (lastErrorMsg.includes('429') || lastErrorMsg.includes('RESOURCE_EXHAUSTED') || lastErrorMsg.toLowerCase().includes('quota')) {
    groundingCooldownUntil = Date.now() + 120_000;
    console.warn(
      '[factChecker] Gemini Google Search grounding quota exceeded; routing verification through direct live web search + Gemini comparison for 120s.'
    );
  }

  return { reason: lastErrorMsg || 'Google Search grounding unavailable.' };
}

/**
 * Generates targeted neutral search queries for a claim when not already attached during extraction
 * (for example, during single-claim re-verification).
 */
async function resolveSearchQueries(claim: ExtractedClaim): Promise<string[]> {
  if (claim.suggestedSearchQueries && claim.suggestedSearchQueries.length > 0) {
    return claim.suggestedSearchQueries;
  }

  try {
    const response = await generateWithModelFallback({
      contents: `Generate 2 concise, neutral web search queries to verify this factual claim from authoritative institutional sources (NASA, ITU, UN, World Bank, IMF, WHO, IEA, IRENA, official government sources).
Rules:
- Do NOT copy potentially false numbers, cities, or countries into the query; focus on the core entity, official metric/attribute, and relevant years.
- For simple geographical, political, or scientific facts, use clean canonical entity + factual attribute queries (e.g., "India official capital city", "Mount Everest location country border", "Pluto dwarf planet classification IAU NASA").
- For global statistics, use canonical statistical terms, synonyms, and official agency names (e.g., "IEA global electric car sales annual", "IRENA installed renewable energy capacity GW").
- For NEGATIVE or THRESHOLD claims (e.g., "fewer than X", "without Internet access", "less than Y", "never", "zero"), include BOTH a query for the asserted concept/metric AND a query targeting the actual opposing/official statistic (e.g., "ITU Facts and Figures global offline population 2024 2025 2026" and "people without internet access worldwide ITU").
Claim: "${claim.originalClaim}"
Category: ${claim.category}
Return JSON: {"queries": ["query 1", "query 2"]}`,
      useLowThinking: true,
      systemInstruction: 'Return only concise neutral search queries as JSON.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          queries: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['queries'],
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as { queries?: string[] };
    if (Array.isArray(parsed.queries) && parsed.queries.length > 0) {
      return parsed.queries.filter((q) => typeof q === 'string' && q.trim().length >= 3).slice(0, 3);
    }
  } catch (err) {
    console.warn(
      `[factChecker] Query generation fallback for ${claim.id}:`,
      err instanceof Error ? err.message.slice(0, 140) : err
    );
  }

  return buildFallbackQueries(claim.originalClaim, claim.category);
}

/**
 * Generates alternative targeted search queries when an initial pass leaves a claim UNVERIFIED.
 * Uses synonyms, canonical entities, years, opposing-statistic phrasing, and alternative statistical
 * terminology targeting official agencies (NASA, ITU, UN, World Bank, WHO, IMF, IEA, IRENA).
 */
async function generateAlternativeQueries(
  claim: ExtractedClaim,
  previousQueries: string[]
): Promise<string[]> {
  try {
    const response = await generateWithModelFallback({
      contents: `Initial web searches did not find decisive authoritative evidence for the claim below.
Generate 3 DIFFERENT, alternative targeted search queries to find official institutional evidence (NASA, ITU, United Nations, World Bank, WHO, IMF, IEA, IRENA, official government sources, or peer-reviewed research).

Claim: "${claim.originalClaim}"
Category: ${claim.category}
Previous queries already tried (DO NOT repeat these): ${previousQueries.join(' | ')}

Rules:
- Vary phrasing using synonyms, canonical entity names, relevant years (e.g., 2024 2025 2026), and alternative official statistical terminology (e.g., "electric vehicle sales" / "BEV PHEV sales IEA", "installed renewable power capacity GW IRENA", "individuals using the Internet ITU").
- For simple geographical, political, or scientific claims, include at least one clean canonical entity name query (e.g., "Mount Everest", "Pluto", "India capital New Delhi") so primary reference and official pages match directly.
- If the claim is negative or uses a threshold ("fewer than", "less than", "without", "never", "zero"), explicitly search for the actual opposing/measured official statistic rather than repeating the negative wording.
- Omit potentially erroneous numbers, locations, or promotional phrasing from the PDF.
- Keep each query concise (2 to 8 words).
Return JSON: {"queries": ["alternative query 1", "alternative query 2", "alternative query 3"]}`,
      useLowThinking: true,
      systemInstruction: 'Return only 2-3 concise alternative search queries as JSON.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          queries: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['queries'],
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as { queries?: string[] };
    const prevLower = new Set(previousQueries.map((q) => q.toLowerCase()));
    if (Array.isArray(parsed.queries)) {
      const fresh = parsed.queries
        .filter((q): q is string => typeof q === 'string' && q.trim().length >= 3)
        .map((q) => q.trim())
        .filter((q) => !prevLower.has(q.toLowerCase()))
        .slice(0, 3);
      if (fresh.length > 0) return fresh;
    }
  } catch (err) {
    console.warn(
      `[factChecker] Alternative query generation fallback for ${claim.id}:`,
      err instanceof Error ? err.message.slice(0, 140) : err
    );
  }

  // Deterministic broader fallback query stripping digits and extra noise
  const stripped = claim.originalClaim
    .replace(/\b\d[\d.,%-]*\b/g, ' ')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(current|today|approximately|approx|about|nearly|roughly|entirely|within|since|fewer|than)$/i.test(w))
    .slice(0, 5)
    .join(' ')
    .trim();

  return stripped.length >= 4
    ? [stripped, `${stripped} official statistics 2025 2026`]
    : buildFallbackQueries(claim.originalClaim, claim.category);
}

/**
 * Checks whether a resolved claim attributes its correction/explanation to an official agency
 * (NASA, ITU, IMF, World Bank, WHO, IEA, IRENA) without actually citing that agency's direct
 * domain or official dataset.
 */
function detectUnbackedAgencyAttribution(result: VerifiedClaim): OfficialInstitution | null {
  const combinedNarrative = `${result.correctedStatement ?? ''} ${result.correctedValue ?? ''} ${result.explanation ?? ''}`;
  const sources = result.sources;

  const hasSourceMatching = (predicate: (domain: string, title: string, url: string) => boolean) =>
    sources.some((s) => predicate(s.domain.toLowerCase(), s.title.toLowerCase(), s.url.toLowerCase()));

  const checks: Array<{
    agency: OfficialInstitution;
    mention: RegExp;
    matched: () => boolean;
  }> = [
    {
      agency: 'NASA',
      mention: /\bnasa\b/i,
      matched: () => hasSourceMatching((d) => /(^|\.)nasa\.gov$/i.test(d)),
    },
    {
      agency: 'ITU',
      mention: /\b(itu|international telecommunication union)\b/i,
      matched: () => hasSourceMatching((d) => /(^|\.)itu\.int$/i.test(d)),
    },
    {
      agency: 'IMF',
      mention: /\b(imf|international monetary fund)\b/i,
      matched: () => hasSourceMatching((d) => /(^|\.)imf\.org$/i.test(d)),
    },
    {
      agency: 'WORLD_BANK',
      mention: /\bworld bank\b/i,
      matched: () => hasSourceMatching((d) => /(^|\.)worldbank\.org$/i.test(d)),
    },
    {
      agency: 'WHO',
      mention: /\b(world health organization|\bwho\b)\b/i,
      matched: () => hasSourceMatching((d) => /(^|\.)who\.int$/i.test(d)),
    },
    {
      agency: 'IEA',
      mention: /\b(iea|international energy agency)\b/i,
      matched: () =>
        hasSourceMatching(
          (d, t) => /(^|\.)iea\.org$/i.test(d) || (/(^|\.)ourworldindata\.org$/i.test(d) && /\b(iea|international energy agency)\b/i.test(t))
        ),
    },
    {
      agency: 'IRENA',
      mention: /\b(irena|international renewable energy agency)\b/i,
      matched: () =>
        hasSourceMatching(
          (d, t) => /(^|\.)irena\.org$/i.test(d) || (/(^|\.)ourworldindata\.org$/i.test(d) && /\b(irena|renewable energy agency)\b/i.test(t))
        ),
    },
    {
      agency: 'NIST',
      mention: /\b(nist|national institute of standards)\b/i,
      matched: () => hasSourceMatching((d) => /(^|\.)nist\.gov$/i.test(d)),
    },
    {
      agency: 'SEC',
      mention: /\b(sec\b|securities and exchange commission|form 10-k|form s-1)\b/i,
      matched: () => hasSourceMatching((d) => /(^|\.)sec\.gov$/i.test(d)),
    },
  ];

  for (const check of checks) {
    if (check.mention.test(combinedNarrative) && !check.matched()) {
      return check.agency;
    }
  }
  return null;
}

/**
 * Deterministic institutional router fallback if Gemini classification fails during Pass 3.
 */
function inferInstitutionHeuristically(claimText: string): OfficialInstitution | 'NONE' {
  const lower = claimText.toLowerCase();
  if (/\b(internet|online|offline|broadband|unconnected|itu)\b/.test(lower)) return 'ITU';
  if (/\b(electric car|electric vehicle|\bev\b|\bevs\b|global ev|iea)\b/.test(lower)) return 'IEA';
  if (/\b(renewable|installed capacity|gigawatt|\bgw\b|irena|solar capacity|wind capacity)\b/.test(lower)) return 'IRENA';
  if (/\b(boiling point|boils at|freezing point|celsius|kelvin|standard.*pressure|nist)\b/.test(lower)) return 'NIST';
  if (/\b(bitcoin|\bbtc\b|21 million|supply cap|halving)\b/.test(lower)) return 'BITCOIN';
  if (/\b(founded|incorporated|headquartered)\b/.test(lower) && /\b(amazon|apple|microsoft|tesla|alphabet|google|nvidia|meta)\b/.test(lower)) return 'SEC';
  if (/\b(pluto|planet|dwarf planet|nasa|solar system|earth|sun|mars|jupiter|saturn|mercury|venus|uranus|neptune|moon|orbit)\b/.test(lower)) return 'NASA';
  if (/\b(gdp|gross domestic product|inflation|imf|nominal gdp)\b/.test(lower)) return 'IMF';
  if (/\b(world population|global population|population)\b/.test(lower)) return 'UN';
  if (/\b(who|health|mortality|life expectancy|vaccine|disease)\b/.test(lower)) return 'WHO';
  if (/\b(capital of|lies in|located in|border|mountain|mount |everest|river|continent|ocean|country)\b/.test(lower)) return 'GEOGRAPHY';
  return 'NONE';
}

/**
 * Final Institutional Evidence Retrieval Check (Pass 3) before assigning UNVERIFIED:
 * Identifies whether a claim is a verifiable public statistic, scientific fact, or geographical/political
 * fact and routes directly to the authoritative institution (NASA, ITU, UN, World Bank, WHO, IMF,
 * IEA, IRENA, GEOGRAPHY) before allowing UNVERIFIED.
 */
async function identifyOfficialStatisticTarget(
  claim: ExtractedClaim,
  previousQueries: string[]
): Promise<{
  hasMeasurableStatistic: boolean;
  institution: OfficialInstitution | 'NONE';
  canonicalQueries: string[];
}> {
  const heuristicMeasurable =
    /\b\d[\d.,]*\b|\b(billion|million|trillion|thousand|percent|%|fewer|less than|more than|majority|half|quarter|rate|distance|diameter|population|gdp|offline|online|capacity|gw|sales|capital|border|planet|mount)\b/i.test(
      claim.originalClaim
    );

  // Fast skip for explicitly confidential/internal private surveys with zero public agency authority
  if (
    /\b(confidential internal|private enterprise|internal poll|proprietary internal|internal survey of \d+ (private|client|enterprise))\b/i.test(
      claim.originalClaim
    )
  ) {
    return { hasMeasurableStatistic: heuristicMeasurable, institution: 'NONE', canonicalQueries: [] };
  }

  try {
    const response = await generateWithModelFallback({
      contents: `A factual claim is about to be marked UNVERIFIED. Perform a FINAL institutional evidence check.
Determine which official international, scientific, statistical, or geographical authority can directly verify or refute this claim.

Claim: "${claim.originalClaim}"
Category: ${claim.category}
Previous queries tried: ${previousQueries.join(' | ')}

Choose "institution" strictly from:
- "ITU" (global internet users, offline/unconnected population, broadband, mobile connectivity)
- "IMF" (country or global GDP, nominal GDP, PPP GDP, inflation, unemployment, macroeconomic outlook)
- "WORLD_BANK" (global/national population, official country capitals, GDP, electricity access, development indicators)
- "WHO" (global health, life expectancy, mortality, vaccines, diseases)
- "UN" (United Nations world population, demographics, climate treaties, global development)
- "NASA" (planets, Pluto dwarf planet status, Sun, Moon, solar system, astronomy, space missions, Earth measurements)
- "IEA" (global electric car / EV sales, energy demand, fossil fuel & clean energy outlooks)
- "IRENA" (global installed renewable energy capacity in GW/MW, solar/wind/hydro capacity)
- "GEOGRAPHY" (country capitals, mountain/river locations, international borders, landmarks, simple geographical/political facts)
- "NONE" (private/internal company survey, proprietary figure, or non-public assertion)

Also provide 2 concise canonical search queries targeting the official entity/statistic (for negative claims, search for the official opposing/measured statistic; for geography, include the canonical entity name).`,
      useLowThinking: true,
      systemInstruction: 'Classify the official verification authority for a final pre-UNVERIFIED check as JSON.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hasMeasurableStatistic: { type: Type.BOOLEAN },
          institution: {
            type: Type.STRING,
            description: 'One of: ITU, IMF, WORLD_BANK, WHO, UN, NASA, IEA, IRENA, GEOGRAPHY, NONE',
          },
          canonicalQueries: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['hasMeasurableStatistic', 'institution', 'canonicalQueries'],
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      hasMeasurableStatistic?: boolean;
      institution?: string;
      canonicalQueries?: string[];
    };

    const validInstitutions = new Set<OfficialInstitution>([
      'ITU',
      'IMF',
      'WORLD_BANK',
      'WHO',
      'UN',
      'NASA',
      'IEA',
      'IRENA',
      'NIST',
      'SEC',
      'BITCOIN',
      'GEOGRAPHY',
    ]);
    const inst = validInstitutions.has(parsed.institution as OfficialInstitution)
      ? (parsed.institution as OfficialInstitution)
      : inferInstitutionHeuristically(claim.originalClaim);

    const queries = Array.isArray(parsed.canonicalQueries)
      ? parsed.canonicalQueries
          .filter((q): q is string => typeof q === 'string' && q.trim().length >= 3)
          .map((q) => q.trim())
          .slice(0, 2)
      : [];

    return {
      hasMeasurableStatistic: Boolean(parsed.hasMeasurableStatistic || heuristicMeasurable),
      institution: inst,
      canonicalQueries: queries,
    };
  } catch {
    return {
      hasMeasurableStatistic: heuristicMeasurable,
      institution: inferInstitutionHeuristically(claim.originalClaim),
      canonicalQueries: buildFallbackQueries(claim.originalClaim, claim.category),
    };
  }
}

/**
 * Evaluates a claim against a ranked list of live web evidence items using Gemini.
 */
async function evaluateEvidenceItems(
  claim: ExtractedClaim,
  evidenceItems: LiveEvidenceItem[],
  executedQueries: string[],
  todayIso: string
): Promise<VerifiedClaim> {
  const evidenceCatalog = evidenceItems
    .map((item: LiveEvidenceItem, index: number) => {
      const n = index + 1;
      const tier = getAuthorityTierLabel(item.authorityScore);
      return `[S${n}] Title: ${item.title}\nDomain: ${item.domain}\nReliability: ${tier}\nPublished/Updated: ${item.publicationDate ?? 'Unknown'}\nURL: ${item.url}\nExcerpt: ${item.snippet}`;
    })
    .join('\n\n');

  const evaluationPrompt = `${buildVerificationInstructions(claim, todayIso)}

RETRIEVED LIVE WEB EVIDENCE (ranked highest institutional reliability first, retrieved live on ${todayIso}):
${evidenceCatalog}

STRICT GROUNDING REQUIREMENTS:
- Evaluate the claim strictly based on the RETRIEVED LIVE WEB EVIDENCE above (and standard unit/math conversions ONLY when year, geography, and statistical definition match).
- Strictly prioritize Tier 1 & Tier 2 official agencies (NASA, ITU, UN, World Bank, IMF, WHO, IEA, IRENA, .gov) and peer-reviewed research over Wikipedia or general news whenever official evidence directly establishes the fact. Do NOT cite Wikipedia or Google News redirect URLs as primary evidence when an official source in the list above already confirms or contradicts the claim.
- Prefer direct publisher and institutional URLs (e.g. nasa.gov, itu.int, imf.org, worldbank.org, un.org, who.int, ourworldindata.org IEA/IRENA datasets, pubmed.ncbi.nlm.nih.gov, doi.org) over news.google.com redirect links.
- NEVER classify an outdated historical statistic as FALSE if the retrieved evidence shows that the figure was approximately valid during an earlier reference period — classify it as INACCURATE and state both the earlier reference period and the latest verified period!
- Set "citedSourceIndices" to the 1-based numbers (e.g. [1, 2]) of ONLY the evidence items [S1]..[S${evidenceItems.length}] that directly support, contradict, or contextualize the claim.
- Every factual figure, percentage, or date inside "correctedStatement" and "correctedValue" MUST be explicitly supported by the excerpt(s) of the source(s) you list in "citedSourceIndices", and MUST state the exact source organization, reference year (and revision year if revised), unit, and statistical definition.
- For any INACCURATE or FALSE claim, copy a literal character-for-character verbatim substring (1–2 sentences copied unchanged from a cited official source's Excerpt block) into "correctionSourceExcerpt". NEVER paraphrase inside "correctionSourceExcerpt".
- If NONE of the retrieved sources contain information about the claim (for example, an unpublished confidential/internal company survey or private client figure), you MUST set "status": "UNVERIFIED", "citedSourceIndices": [], "correctedStatement": null, and "correctionSourceExcerpt": null. Do NOT force an unrelated source!`;

  const response = await generateWithModelFallback({
    contents: evaluationPrompt,
    useLowThinking: true,
    systemInstruction:
      'You are a rigorous fact-checking analyst. Compare the PDF claim strictly against the provided live web evidence. Prioritize official institutional sources (NASA, ITU, UN, World Bank, IMF, WHO, IEA, IRENA) over Wikipedia and news redirects. Never classify outdated historical figures as FALSE (classify as INACCURATE). Never paraphrase inside correctionSourceExcerpt — copy verbatim from the retrieved Excerpt. Output strictly valid JSON.',
    responseMimeType: 'application/json',
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Empty verification evaluation returned by Gemini.');
  }

  const parsed = extractBalancedJson(rawText) as Record<string, unknown>;

  // Map citedSourceIndices back to real, verified URLs from evidenceItems
  const rawIndices = Array.isArray(parsed.citedSourceIndices) ? parsed.citedSourceIndices : [];
  const validIndices = [
    ...new Set(
      rawIndices
        .map((n) => Math.round(Number(n)))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= evidenceItems.length)
    ),
  ];

  const selectedItems = validIndices
    .map((idx) => evidenceItems[idx - 1])
    .sort((a, b) => b.authorityScore - a.authorityScore);

  // Strictly exclude Google News redirect wrappers — NEVER cite redirect links
  let keptItems = selectedItems.filter((item) => !isGoogleNewsRedirectUrl(item.url));

  // Replace Wikipedia as primary evidence whenever ANY authoritative Tier 1/2 institutional,
  // standards, corporate-filing, protocol, geographical, or peer-reviewed source (score >= 92) is cited.
  const authoritativeNonWiki = keptItems.filter(
    (item) => item.authorityScore >= 92 && !item.domain.toLowerCase().includes('wikipedia.org')
  );
  if (authoritativeNonWiki.length > 0 && authoritativeNonWiki.length < keptItems.length) {
    const withoutWikipedia = keptItems.filter(
      (item) => !item.domain.toLowerCase().includes('wikipedia.org')
    );
    if (withoutWikipedia.length > 0) {
      keptItems = withoutWikipedia;
    }
  }

  // Validate all cited URLs are live (no broken 404/410/5xx links)
  if (keptItems.length > 0) {
    const validatedFlags = await Promise.all(
      keptItems.map(async (item) => ({ item, ok: await validateSourceUrl(item.url) }))
    );
    const liveOnly = validatedFlags.filter((r) => r.ok).map((r) => r.item);
    if (liveOnly.length > 0) {
      keptItems = liveOnly;
    }
  }

  const citedSources: SourceCitation[] = keptItems.map((item) => ({
    title: item.title,
    url: item.url,
    domain: item.domain,
    publicationDate: item.publicationDate,
    excerpt: item.snippet ? item.snippet.slice(0, 320).trim() : null,
  }));

  const fullSnippets = keptItems
    .map((item) => item.snippet)
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

  const verified = assembleVerifiedClaim(
    claim,
    parsed,
    citedSources,
    executedQueries,
    todayIso,
    true,
    fullSnippets
  );

  // If model marked VERIFIED/INACCURATE/FALSE but failed to cite ANY retrieved source, downgrade to UNVERIFIED
  if (verified.status !== 'UNVERIFIED' && verified.sources.length === 0) {
    console.warn(
      `[factChecker] ${claim.id} had status ${verified.status} with 0 cited sources; downgrading to UNVERIFIED.`
    );
    return buildUnverifiedFallback(
      claim,
      todayIso,
      true,
      [],
      executedQueries,
      'Live web search found no directly applicable authoritative source to confirm or contradict this claim.'
    );
  }

  return verified;
}

/**
 * Enforces direct official-agency source attribution: if a verdict credits NASA, ITU, IMF,
 * World Bank, or WHO without citing that agency's direct domain (e.g. relying only on Wikipedia),
 * forces live retrieval from that official agency and re-evaluates so the official source is cited directly.
 */
async function enforceDirectInstitutionalAttribution(
  claim: ExtractedClaim,
  candidateResult: VerifiedClaim,
  existingItems: LiveEvidenceItem[],
  executedQueries: string[],
  todayIso: string
): Promise<VerifiedClaim> {
  const missingAgency = detectUnbackedAgencyAttribution(candidateResult);
  if (!missingAgency) return candidateResult;

  console.info(
    `[factChecker] ${claim.id} attributed finding to ${missingAgency} without citing ${missingAgency}'s direct domain; fetching official ${missingAgency} sources directly.`
  );

  try {
    const directAgencyItems = await queryOfficialInstitution(
      missingAgency,
      claim.originalClaim,
      executedQueries
    );
    if (directAgencyItems.length === 0) return candidateResult;

    const seen = new Set<string>();
    const merged: LiveEvidenceItem[] = [];
    for (const item of [...directAgencyItems, ...existingItems].sort(
      (a, b) => b.authorityScore - a.authorityScore
    )) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }

    const upgraded = await evaluateEvidenceItems(
      claim,
      merged.slice(0, 8),
      executedQueries,
      todayIso
    );
    if (upgraded.status !== 'UNVERIFIED' && upgraded.sources.length > 0) {
      console.info(
        `[factChecker] ${claim.id} upgraded direct attribution to ${missingAgency} -> ${upgraded.sources.map((s) => s.domain).join(', ')}`
      );
      return upgraded;
    }
  } catch (err) {
    console.warn(
      `[factChecker] Direct ${missingAgency} attribution upgrade failed for ${claim.id}:`,
      err instanceof Error ? err.message.slice(0, 160) : err
    );
  }

  return candidateResult;
}

/**
 * Multi-pass direct live web verification path:
 * Pass 1: Parallel live HTTPS retrieval from IMF, World Bank, ITU, NASA, WHO, PubMed, Crossref,
 *         Wikipedia, and Google News + Gemini evidence comparison + Direct Attribution Guard.
 * Pass 2: If UNVERIFIED, generates alternative/opposing-statistic queries and retries with deep academic search.
 * Pass 3 (Final Institutional Check): Before assigning UNVERIFIED on any measurable statistic,
 *         identifies the authoritative official agency (ITU, UN, World Bank, WHO, IMF, NASA) measuring
 *         that exact statistic, forces direct institutional retrieval, and re-evaluates.
 */
async function verifyWithDirectLiveWebSearch(
  claim: ExtractedClaim,
  todayIso: string
): Promise<VerifiedClaim> {
  const targetedQueries = await resolveSearchQueries(claim);
  const pass1Search = await searchLiveWebEvidence(claim.originalClaim, claim.category, targetedQueries);

  let combinedQueries = [...pass1Search.queries];
  let combinedItems = [...pass1Search.items];
  let pass1Result: VerifiedClaim | null = null;

  if (pass1Search.items.length > 0) {
    try {
      pass1Result = await evaluateEvidenceItems(
        claim,
        pass1Search.items,
        combinedQueries,
        todayIso
      );
      if (pass1Result.status !== 'UNVERIFIED') {
        const guarded = await enforceDirectInstitutionalAttribution(
          claim,
          pass1Result,
          combinedItems,
          combinedQueries,
          todayIso
        );
        console.info(
          `[factChecker] ${claim.id} verified via direct live web search (Pass 1) -> ${guarded.status} (${guarded.sources.length} authoritative sources)`
        );
        return guarded;
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`[factChecker] Pass 1 evidence comparison failed for ${claim.id}:`, errMessage.slice(0, 240));
    }
  }

  // Pass 2: Retry with alternative / opposing-statistic targeted search queries
  console.info(
    `[factChecker] ${claim.id} remained UNVERIFIED after Pass 1; retrying with alternative targeted search queries.`
  );
  const altQueries = await generateAlternativeQueries(claim, combinedQueries);
  const seenUrls = new Set(combinedItems.map((item) => item.url));
  const pass2Search = await searchLiveWebEvidence(claim.originalClaim, claim.category, altQueries, {
    excludeUrls: seenUrls,
    deepAcademicRetry: true,
  });

  combinedQueries = [...new Set([...combinedQueries, ...pass2Search.queries])];
  let latestUnverified: VerifiedClaim | null = pass1Result;

  if (pass2Search.items.length > 0) {
    combinedItems = [...combinedItems, ...pass2Search.items]
      .sort((a, b) => b.authorityScore - a.authorityScore)
      .slice(0, 8);

    try {
      const pass2Result = await evaluateEvidenceItems(
        claim,
        combinedItems,
        combinedQueries,
        todayIso
      );
      if (pass2Result.status !== 'UNVERIFIED') {
        const guarded = await enforceDirectInstitutionalAttribution(
          claim,
          pass2Result,
          combinedItems,
          combinedQueries,
          todayIso
        );
        console.info(
          `[factChecker] ${claim.id} completed Pass 2 retry -> ${guarded.status} (${guarded.sources.length} authoritative sources, ${combinedQueries.length} queries)`
        );
        return guarded;
      }
      latestUnverified = pass2Result;
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`[factChecker] Pass 2 evidence comparison failed for ${claim.id}:`, errMessage.slice(0, 240));
    }
  }

  // Pass 3: Final Institutional Evidence Retrieval Check before assigning UNVERIFIED
  const finalCheck = await identifyOfficialStatisticTarget(claim, combinedQueries);
  if (finalCheck.institution !== 'NONE') {
    console.info(
      `[factChecker] ${claim.id} triggered Final Institutional Check (${finalCheck.institution}) before assigning UNVERIFIED.`
    );
    const checkQueries =
      finalCheck.canonicalQueries.length > 0 ? finalCheck.canonicalQueries : combinedQueries;
    combinedQueries = [...new Set([...combinedQueries, ...checkQueries])];

    try {
      const [instItems, extraSearch] = await Promise.all([
        queryOfficialInstitution(finalCheck.institution, claim.originalClaim, checkQueries),
        finalCheck.canonicalQueries.length > 0
          ? searchLiveWebEvidence(claim.originalClaim, claim.category, finalCheck.canonicalQueries, {
              excludeUrls: new Set(combinedItems.map((i) => i.url)),
              deepAcademicRetry: true,
            })
          : Promise.resolve({ queries: [], items: [], errors: [] }),
      ]);

      const mergedSeen = new Set<string>();
      const mergedItems: LiveEvidenceItem[] = [];
      for (const item of [...instItems, ...extraSearch.items, ...combinedItems].sort(
        (a, b) => b.authorityScore - a.authorityScore
      )) {
        if (mergedSeen.has(item.url)) continue;
        mergedSeen.add(item.url);
        mergedItems.push(item);
      }

      if (mergedItems.length > 0) {
        const pass3Result = await evaluateEvidenceItems(
          claim,
          mergedItems.slice(0, 8),
          combinedQueries,
          todayIso
        );
        if (pass3Result.status !== 'UNVERIFIED') {
          const guarded = await enforceDirectInstitutionalAttribution(
            claim,
            pass3Result,
            mergedItems,
            combinedQueries,
            todayIso
          );
          console.info(
            `[factChecker] ${claim.id} resolved in Final Institutional Check (${finalCheck.institution}) -> ${guarded.status} (${guarded.sources.length} sources)`
          );
          return guarded;
        }
        latestUnverified = pass3Result;
      }
    } catch (err) {
      console.warn(
        `[factChecker] Final Institutional Check failed for ${claim.id}:`,
        err instanceof Error ? err.message.slice(0, 180) : err
      );
    }
  }

  if (latestUnverified) {
    console.info(
      `[factChecker] ${claim.id} retained UNVERIFIED after all verification passes (${combinedQueries.length} total queries tried).`
    );
    return {
      ...latestUnverified,
      searchQueries: combinedQueries,
    };
  }

  console.warn(
    `[factChecker] Direct live web search returned 0 evidence items across all passes for ${claim.id} (queries: ${combinedQueries.join(' | ')})`
  );
  return buildUnverifiedFallback(
    claim,
    todayIso,
    true,
    [],
    combinedQueries,
    'Live web search executed initial, alternative, and official institutional checks but found no public authoritative sources addressing this claim.'
  );
}

function assembleVerifiedClaim(
  claim: ExtractedClaim,
  parsed: Record<string, unknown>,
  verifiedSources: SourceCitation[],
  searchQueries: string[],
  todayIso: string,
  liveSearchExecuted: boolean,
  fullSnippets: string[] = []
): VerifiedClaim {
  const status: ClaimStatus = VALID_STATUSES.has(parsed.status as ClaimStatus)
    ? (parsed.status as ClaimStatus)
    : 'UNVERIFIED';

  const primaryPubDate =
    typeof parsed.sourcePublicationDate === 'string' && parsed.sourcePublicationDate.trim()
      ? parsed.sourcePublicationDate.trim()
      : null;

  // Always order cited sources strictly by institutional authority (and deprioritize redirect wrappers)
  const rankedSources = [...verifiedSources].sort(
    (a, b) => scoreAuthority(b.domain, b.title, b.url) - scoreAuthority(a.domain, a.title, a.url)
  );

  const sourcesWithDates = rankedSources.slice(0, 6).map((src, idx) =>
    idx === 0 && !src.publicationDate && primaryPubDate
      ? { ...src, publicationDate: primaryPubDate }
      : src
  );

  const supportingEvidence = toStringArray(parsed.supportingEvidence);
  const contradictoryEvidence = toStringArray(parsed.contradictoryEvidence);

  const explanation =
    typeof parsed.explanation === 'string' && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : 'Verification analysis completed using live web sources.';
  const evidenceSummary =
    typeof parsed.evidenceSummary === 'string' && parsed.evidenceSummary.trim()
      ? parsed.evidenceSummary.trim()
      : 'Live evidence reviewed.';

  const isCorrectedStatus = status === 'INACCURATE' || status === 'FALSE';
  const correctedStatement = isCorrectedStatus ? toNullableString(parsed.correctedStatement) : null;
  const correctedValue = isCorrectedStatus ? toNullableString(parsed.correctedValue) : null;
  const rawCorrectionExcerpt = toNullableString(parsed.correctionSourceExcerpt);

  // Programmatically enforce verbatim source excerpts — never show an AI paraphrase as a quote
  const verbatimReference = `${correctedValue ?? ''} ${correctedStatement ?? ''} ${claim.originalClaim}`;
  const verifiedVerbatimExcerpt = isCorrectedStatus
    ? resolveVerbatimCorrectionExcerpt(rawCorrectionExcerpt, fullSnippets, verbatimReference)
    : null;

  return {
    ...claim,
    status,
    evidenceSummary,
    supportingEvidence,
    contradictoryEvidence,
    explanation,
    correctedStatement,
    correctionSourceExcerpt: verifiedVerbatimExcerpt,
    originalValue: toNullableString(parsed.originalValue),
    correctedValue,
    differenceSummary: isCorrectedStatus ? toNullableString(parsed.differenceSummary) : null,
    originalDataPeriod: toNullableString(parsed.originalDataPeriod) ?? claim.documentDataPeriod ?? null,
    latestDataPeriod: toNullableString(parsed.latestDataPeriod),
    sourceDisagreement: toNullableString(parsed.sourceDisagreement),
    sources: sourcesWithDates,
    searchQueries,
    liveSearchExecuted,
    searchError: null,
    lastVerifiedDate: todayIso,
  };
}

export async function verifySingleClaim(
  claim: ExtractedClaim,
  todayIso: string
): Promise<VerifiedClaim> {
  // Path 1: Direct live institutional & authoritative web retrieval first (IMF WEO, World Bank,
  // ITU Facts & Figures, NASA Goddard/Science, WHO, PubMed, Crossref, Wikipedia, direct publisher news)
  // so Tier 1 official agencies, direct canonical URLs, and verifiable verbatim excerpts lead.
  const directResult = await verifyWithDirectLiveWebSearch(claim, todayIso);
  if (directResult.status !== 'UNVERIFIED') {
    return directResult;
  }

  // Path 2: Secondary live backup via Gemini built-in Google Search Grounding when direct
  // institutional retrieval leaves a claim UNVERIFIED.
  const groundingResult = await tryGeminiGoogleSearchGrounding(claim, todayIso);
  if ('claim' in groundingResult && groundingResult.claim.status !== 'UNVERIFIED') {
    return {
      ...groundingResult.claim,
      searchQueries: [
        ...new Set([...directResult.searchQueries, ...groundingResult.claim.searchQueries]),
      ],
    };
  }

  if ('claim' in groundingResult) {
    return {
      ...directResult,
      searchQueries: [
        ...new Set([...directResult.searchQueries, ...groundingResult.claim.searchQueries]),
      ],
    };
  }

  return directResult;
}

function buildUnverifiedFallback(
  claim: ExtractedClaim,
  todayIso: string,
  liveSearchExecuted: boolean,
  sources: SourceCitation[],
  searchQueries: string[],
  errorReason: string
): VerifiedClaim {
  return {
    ...claim,
    status: 'UNVERIFIED',
    evidenceSummary: liveSearchExecuted
      ? 'No public authoritative sources found to confirm or disprove this claim.'
      : 'Verification could not be completed with live web evidence.',
    supportingEvidence: [],
    contradictoryEvidence: [],
    explanation: `${errorReason} Marked as UNVERIFIED rather than assuming accuracy or falsity.`,
    correctedStatement: null,
    originalValue: claim.extractedValues[0] ?? null,
    correctedValue: null,
    differenceSummary: null,
    originalDataPeriod: claim.documentDataPeriod ?? null,
    latestDataPeriod: null,
    sourceDisagreement: null,
    sources,
    searchQueries,
    liveSearchExecuted,
    searchError: liveSearchExecuted ? null : errorReason,
    lastVerifiedDate: todayIso,
  };
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function toNullableString(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'none') {
    return null;
  }
  return trimmed;
}

export function computeSummary(claims: VerifiedClaim[]): ReportSummary {
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

  let accuracyBasis: string;
  if (totalClaims === 0) {
    accuracyBasis = 'No verifiable factual claims were extracted from this document';
  } else if (resolvedClaims === 0) {
    accuracyBasis = `Verified-True Share is N/A because 0 of ${totalClaims} total claims could be resolved with public live evidence (${unverified} remain unverified, not proven false; Verification Coverage: 0%)`;
  } else {
    accuracyBasis = `Verified-True Share: ${verified} of ${resolvedClaims} resolved claims verified as accurate (${inaccurate} inaccurate, ${falseCount} false). ${unverified} of ${totalClaims} total claims remain unverified and are excluded rather than treated as false. Verification Coverage: ${verificationCoverage}% (${resolvedClaims} of ${totalClaims} claims resolved via live web evidence)`;
  }

  return {
    totalClaims,
    verified,
    inaccurate,
    falseCount,
    unverified,
    resolvedClaims,
    verificationCoverage,
    overallAccuracy,
    accuracyBasis,
  };
}

export async function generateExecutiveSummary(
  documentName: string,
  claims: VerifiedClaim[],
  summary: ReportSummary
): Promise<{ executiveSummary: string; recommendations: string[] }> {
  if (claims.length === 0) {
    return {
      executiveSummary: `No verifiable factual claims, statistics, or empirical assertions were identified in "${documentName}".`,
      recommendations: [
        'Confirm the uploaded PDF contains factual statements, statistics, or technical claims rather than purely narrative or decorative copy.',
      ],
    };
  }

  const resolvedClaims =
    summary.resolvedClaims ?? summary.verified + summary.inaccurate + summary.falseCount;
  const verifiedTrueShareLabel =
    summary.overallAccuracy === null ? 'N/A (no claims resolved)' : `${summary.overallAccuracy}%`;
  const coverageLabel = `${summary.verificationCoverage ?? 0}%`;

  const fallbackExecutiveSummary = `Out of ${summary.totalClaims} total factual claims extracted from "${documentName}", ${resolvedClaims} were resolved using live web evidence (${coverageLabel} Verification Coverage) and ${summary.unverified} remain unverified due to a lack of publicly accessible sources. Among the ${resolvedClaims} resolved claims, ${summary.verified} were verified as accurate (${verifiedTrueShareLabel} Verified-True Share), ${summary.inaccurate} were inaccurate or outdated, and ${summary.falseCount} were contradicted as false. Unverified claims are excluded from the Verified-True Share and should not be interpreted as false.`;

  try {
    const condensedFindings = claims.map((c) => ({
      id: c.id,
      page: c.pageNumber,
      status: c.status,
      claim: c.originalClaim,
      correction: c.correctedStatement,
      periodDelta:
        c.originalDataPeriod || c.latestDataPeriod
          ? `${c.originalDataPeriod ?? 'unspecified'} vs ${c.latestDataPeriod ?? 'latest'}`
          : null,
    }));

    const response = await generateWithModelFallback({
      contents: `Generate an executive fact-checking summary and 3 to 5 concrete editorial recommendations for "${documentName}".
Exact Audit Metrics:
- Total Extracted Claims: ${summary.totalClaims}
- Resolved Claims (classified via live web evidence): ${resolvedClaims} (${coverageLabel} Verification Coverage)
- Verified as Accurate: ${summary.verified} (${verifiedTrueShareLabel} Verified-True Share of resolved claims)
- Inaccurate / Outdated: ${summary.inaccurate}
- False (directly contradicted): ${summary.falseCount}
- Unverified (insufficient public evidence): ${summary.unverified}

Findings JSON:
${JSON.stringify(condensedFindings)}

MANDATORY RULES:
- Clearly distinguish TOTAL extracted claims (${summary.totalClaims}) from RESOLVED claims (${resolvedClaims}).
- Explicitly state how many claims remain UNVERIFIED (${summary.unverified}).
- NEVER state or imply that unverified claims are false; clarify that unverified claims simply lacked public evidence to confirm or disprove and are excluded from the Verified-True Share.
- Use the term "Verified-True Share" (NOT "Overall Accuracy") when citing ${verifiedTrueShareLabel}.
- Stay strictly grounded in the findings above. Highlight the most important corrections with claim IDs and page numbers.
- Provide 3 to 5 concrete, actionable publication-readiness recommendations.`,
      useLowThinking: true,
      systemInstruction:
        'You are an executive fact-checking editor. Synthesize verified audit results objectively as JSON. Always distinguish total claims from resolved claims, state unverified counts clearly, and never imply unverified claims are false.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          executiveSummary: {
            type: Type.STRING,
            description:
              'A crisp 3-4 sentence executive summary clearly distinguishing total claims from resolved claims, stating how many remain unverified without implying they are false, and using Verified-True Share.',
          },
          recommendations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '3 to 5 specific, actionable recommendations before publishing.',
          },
        },
        required: ['executiveSummary', 'recommendations'],
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      executiveSummary?: string;
      recommendations?: string[];
    };

    return {
      executiveSummary:
        typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
          ? parsed.executiveSummary.trim()
          : fallbackExecutiveSummary,
      recommendations:
        Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0
          ? parsed.recommendations.filter((r) => typeof r === 'string' && r.trim().length > 0)
          : ['Review and update all flagged inaccurate and false claims prior to publication.'],
    };
  } catch (err) {
    console.warn('[factChecker] Executive summary generation fallback:', err instanceof Error ? err.message.slice(0, 140) : err);
    return {
      executiveSummary: fallbackExecutiveSummary,
      recommendations: [
        'Correct all claims marked FALSE or INACCURATE using the cited primary sources before publication.',
        'Add explicit data reference periods and primary source citations for statistical figures.',
        'Substantiate or clearly label internal/proprietary figures marked UNVERIFIED.',
      ],
    };
  }
}
