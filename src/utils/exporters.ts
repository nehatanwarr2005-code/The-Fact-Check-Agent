import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FactCheckReport } from '../types/factCheck';
import {
  formatDateShort,
  formatDateTime,
  getSafeHref,
  resolveSummaryMetrics,
  STATUS_CONFIG,
} from './formatting';

function buildSafeBaseName(docName: string): string {
  const withoutExt = docName.replace(/\.pdf$/i, '');
  const safe = withoutExt.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'fact_check_report';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Shortens excessively long evidence text or verbatim excerpts for PDF readability
 * strictly along natural sentence/clause/word boundaries without altering source wording.
 */
function formatConcisePdfText(raw: string, maxChars: number): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;
  const slice = cleaned.slice(0, maxChars);
  const lastPeriod = slice.lastIndexOf('. ');
  if (lastPeriod >= Math.floor(maxChars * 0.55)) {
    return slice.slice(0, lastPeriod + 1).trim();
  }
  const lastSemi = slice.lastIndexOf('; ');
  if (lastSemi >= Math.floor(maxChars * 0.55)) {
    return `${slice.slice(0, lastSemi).trim()}…`;
  }
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace >= Math.floor(maxChars * 0.55) ? lastSpace : maxChars - 1;
  return `${slice.slice(0, cut).trim()}…`;
}

/**
 * Protects exported CSV cells against spreadsheet formula injection (=, +, -, @, tab, CR)
 * and applies standard RFC-4180 quoting.
 */
function escapeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const escaped = safe.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function exportReportAsJson(report: FactCheckReport): void {
  const filename = `${buildSafeBaseName(report.documentName)}_fact_check_report.json`;
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerDownload(blob, filename);
}

export function exportReportAsCsv(report: FactCheckReport): void {
  const headers = [
    'Claim ID',
    'Page Number',
    'Additional Pages',
    'Category',
    'Original Claim',
    'Verification Status',
    'Evidence Found',
    'Supporting Evidence',
    'Contradictory Evidence',
    'Corrected Information',
    'Correction Source Excerpt',
    'Original Value',
    'Verified Value',
    'Difference Summary',
    'Original Data Period',
    'Latest Data Period',
    'Explanation',
    'Source Links',
    'Last Verified Date',
  ];

  const rows = report.claims.map((claim) => [
    claim.id,
    claim.pageNumber,
    claim.additionalPages?.join('; ') ?? '',
    claim.category,
    claim.originalClaim,
    STATUS_CONFIG[claim.status].label,
    claim.evidenceSummary,
    claim.supportingEvidence.join(' | '),
    claim.contradictoryEvidence.join(' | '),
    claim.correctedStatement ?? '',
    claim.correctionSourceExcerpt ?? '',
    claim.originalValue ?? '',
    claim.correctedValue ?? '',
    claim.differenceSummary ?? '',
    claim.originalDataPeriod ?? '',
    claim.latestDataPeriod ?? '',
    claim.explanation,
    claim.sources
      .map((s) => `${s.title}${s.publicationDate ? ` [Published ${s.publicationDate}]` : ''} (${s.url})`)
      .join(' | '),
    claim.lastVerifiedDate,
  ]);

  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\r\n');

  const filename = `${buildSafeBaseName(report.documentName)}_fact_check_results.csv`;
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

export function exportReportAsPdf(report: FactCheckReport): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;

  // Header band
  doc.setFillColor(15, 30, 61); // Deep Navy
  doc.rect(0, 0, pageWidth, 88, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('The Fact-Check Agent', margin, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(191, 219, 254);
  doc.text("Independent Document Verification Report  |  Don't Just Publish. Verify.", margin, 54);

  doc.setFontSize(9);
  doc.setTextColor(226, 232, 240);
  doc.text(`Audit ID: ${report.id}   |   Analyzed: ${formatDateTime(report.analysisDate)}`, margin, 72);

  let y = 112;

  // Document Metadata
  doc.setTextColor(15, 30, 61);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('1. Document Overview', margin, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  const resolvedMetrics = resolveSummaryMetrics(report.summary);
  const metaLines = [
    `Original Document: ${report.documentName}`,
    `Pages Analyzed: ${report.pageCount}   |   Extraction Mode: ${report.extractionMethod === 'ocr' ? 'AI OCR (Scanned PDF)' : 'Direct PDF Text Layer'}   |   Live Web Search: ${report.liveSearchAvailable ? 'Active' : 'Unavailable'}`,
    `Metric Basis: ${resolvedMetrics.metricBasis}`,
  ];
  for (const line of metaLines) {
    const wrapped = doc.splitTextToSize(line, contentWidth) as string[];
    doc.text(wrapped, margin, y);
    y += wrapped.length * 13 + 2;
  }

  // Summary Metric Boxes
  y += 8;
  const boxGap = 6;
  const boxWidth = (contentWidth - boxGap * 6) / 7;
  const metrics = [
    { label: 'Verified-True', value: resolvedMetrics.verifiedTrueShareLabel, rgb: [15, 30, 61] as [number, number, number] },
    { label: 'Coverage', value: `${resolvedMetrics.verificationCoverage}%`, rgb: [37, 99, 235] as [number, number, number] },
    { label: 'Total Claims', value: String(report.summary.totalClaims), rgb: [15, 30, 61] as [number, number, number] },
    { label: 'Verified Acc.', value: String(report.summary.verified), rgb: [21, 128, 61] as [number, number, number] },
    { label: 'Inaccurate', value: String(report.summary.inaccurate), rgb: [217, 119, 6] as [number, number, number] },
    { label: 'False', value: String(report.summary.falseCount), rgb: [220, 38, 38] as [number, number, number] },
    { label: 'Unverified', value: String(report.summary.unverified), rgb: [100, 116, 139] as [number, number, number] },
  ];

  metrics.forEach((m, idx) => {
    const x = margin + idx * (boxWidth + boxGap);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, boxWidth, 46, 4, 4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(m.rgb[0], m.rgb[1], m.rgb[2]);
    doc.text(m.value, x + 7, y + 23);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(m.label, x + 7, y + 37);
  });

  y += 66;

  // Executive Summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 30, 61);
  doc.text('2. Executive Summary', margin, y);
  y += 15;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  const summaryWrapped = doc.splitTextToSize(report.executiveSummary, contentWidth) as string[];
  doc.text(summaryWrapped, margin, y);
  y += summaryWrapped.length * 13.5 + 14;

  // Detailed Claim-by-Claim Findings Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 30, 61);
  doc.text('3. Claim-by-Claim Verification Findings', margin, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['ID', 'Pg', 'Original Claim', 'Status', 'Evidence & Corrected Information', 'Verified']],
    body: report.claims.map((claim) => {
      const analysisText = `AI Analysis: ${formatConcisePdfText(claim.evidenceSummary, 200)}`;
      const supportingText =
        claim.supportingEvidence.length > 0
          ? `\nSupporting: ${formatConcisePdfText(claim.supportingEvidence.slice(0, 2).join('; '), 190)}`
          : '';
      const contradictoryText =
        claim.contradictoryEvidence.length > 0
          ? `\nContradictory: ${formatConcisePdfText(claim.contradictoryEvidence.slice(0, 2).join('; '), 190)}`
          : '';
      const correctionText = claim.correctedStatement
        ? `\nCorrection: ${formatConcisePdfText(claim.correctedStatement, 220)}`
        : '';
      const excerptText = claim.correctionSourceExcerpt
        ? `\nVerbatim Source Quote: "${formatConcisePdfText(claim.correctionSourceExcerpt, 220)}"`
        : '';
      const periodText =
        claim.originalDataPeriod || claim.latestDataPeriod
          ? `\nPeriod: ${claim.originalDataPeriod ?? 'N/A'} -> ${claim.latestDataPeriod ?? 'Latest'}`
          : '';
      return [
        claim.id,
        String(claim.pageNumber),
        claim.originalClaim,
        STATUS_CONFIG[claim.status].label,
        `${analysisText}${supportingText}${contradictoryText}${correctionText}${excerptText}${periodText}`,
        formatDateShort(claim.lastVerifiedDate),
      ];
    }),
    styles: {
      fontSize: 8,
      cellPadding: 5,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
      valign: 'top',
    },
    headStyles: {
      fillColor: [15, 30, 61],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: 44, fontStyle: 'bold' },
      1: { cellWidth: 22, halign: 'center' },
      2: { cellWidth: 138 },
      3: { cellWidth: 68, fontStyle: 'bold' },
      4: { cellWidth: 184 },
      5: { cellWidth: 55 },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 3) {
        const val = String(data.cell.raw);
        if (val === STATUS_CONFIG.VERIFIED.label) data.cell.styles.textColor = [21, 128, 61];
        else if (val === STATUS_CONFIG.INACCURATE.label) data.cell.styles.textColor = [194, 65, 12];
        else if (val === STATUS_CONFIG.FALSE.label) data.cell.styles.textColor = [185, 28, 28];
        else data.cell.styles.textColor = [71, 85, 105];
      }
    },
  });

  const lastTableY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 60;
  y = lastTableY + 22;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 54) {
      doc.addPage();
      y = 54;
    }
  };

  // Section 4: Corrected Facts & Statistics
  const correctedClaims = report.claims.filter(
    (c) => (c.status === 'INACCURATE' || c.status === 'FALSE') && c.correctedStatement
  );

  if (correctedClaims.length > 0) {
    ensureSpace(80);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 30, 61);
    doc.text('4. Summary of Required Corrections', margin, y);
    y += 8;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['ID / Pg', 'Document Statement', 'Verified Correction', 'Delta / Data Period']],
      body: correctedClaims.map((c) => [
        `${c.id} (p.${c.pageNumber})`,
        c.originalValue ? `${c.originalValue}\n${c.originalClaim}` : c.originalClaim,
        c.correctionSourceExcerpt
          ? `AI Correction: ${formatConcisePdfText(c.correctedStatement ?? '', 230)}\n\nVerbatim Source Quote: "${formatConcisePdfText(c.correctionSourceExcerpt, 230)}"`
          : `AI Correction: ${formatConcisePdfText(c.correctedStatement ?? '', 240)}`,
        [
          c.differenceSummary ? formatConcisePdfText(c.differenceSummary, 110) : null,
          c.originalDataPeriod ? `PDF: ${c.originalDataPeriod}` : null,
          c.latestDataPeriod ? `Latest: ${c.latestDataPeriod}` : null,
        ]
          .filter(Boolean)
          .join('\n') || 'See correction',
      ]),
      styles: { fontSize: 8, cellPadding: 5, textColor: [30, 41, 59], valign: 'top' },
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 62, fontStyle: 'bold' },
        1: { cellWidth: 160 },
        2: { cellWidth: 180 },
        3: { cellWidth: 109 },
      },
    });

    const corrY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 60;
    y = corrY + 22;
  }

  // Section 5: Recommendations
  ensureSpace(90);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 30, 61);
  doc.text(
    correctedClaims.length > 0 ? '5. Final Editorial Recommendations' : '4. Final Editorial Recommendations',
    margin,
    y
  );
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  report.recommendations.forEach((rec, i) => {
    const lines = doc.splitTextToSize(`${i + 1}. ${rec}`, contentWidth) as string[];
    ensureSpace(lines.length * 13.5 + 6);
    doc.text(lines, margin, y);
    y += lines.length * 13.5 + 5;
  });

  // Section 6: Verified Source Citations Appendix
  const claimsWithSources = report.claims.filter((c) => c.sources.length > 0);
  if (claimsWithSources.length > 0) {
    y += 10;
    ensureSpace(70);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 30, 61);
    doc.text(
      correctedClaims.length > 0 ? '6. Verified Source Citations' : '5. Verified Source Citations',
      margin,
      y
    );
    y += 15;

    doc.setFontSize(8.5);
    for (const claim of claimsWithSources) {
      ensureSpace(28);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 30, 61);
      doc.text(`${claim.id} (p.${claim.pageNumber})`, margin, y);
      y += 12;

      doc.setFont('helvetica', 'normal');
      for (const s of claim.sources) {
        const safeUrl = getSafeHref(s.url);
        const label = `${s.title}${s.publicationDate ? ` (Published ${s.publicationDate})` : ''} [${s.domain}]`;
        const wrappedLabel = doc.splitTextToSize(label, contentWidth - 10) as string[];
        ensureSpace(wrappedLabel.length * 11 + 16);
        doc.setTextColor(51, 65, 85);
        doc.text(wrappedLabel, margin + 8, y);
        y += wrappedLabel.length * 11;

        if (safeUrl) {
          doc.setTextColor(37, 99, 235);
          const displayUrl = safeUrl.length > 96 ? `${safeUrl.slice(0, 93)}...` : safeUrl;
          doc.textWithLink(displayUrl, margin + 8, y, { url: safeUrl });
          y += 13;
        }
      }
      y += 4;
    }
  }

  // Add page numbers to every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `The Fact-Check Agent  ·  ${report.documentName}`,
      margin,
      pageHeight - 24
    );
    doc.text(
      `Page ${p} of ${totalPages}`,
      pageWidth - margin - 54,
      pageHeight - 24
    );
  }

  const filename = `${buildSafeBaseName(report.documentName)}_fact_check_report.pdf`;
  doc.save(filename);
}
