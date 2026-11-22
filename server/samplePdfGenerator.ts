import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

let cachedSamplePdf: Buffer | null = null;

/**
 * Generates a realistic 3-page corporate market research PDF containing a deliberate mix of:
 * - Accurate, verifiable facts
 * - Outdated statistics presented as current
 * - Intentionally false / fabricated claims
 * - Unverifiable internal survey metrics
 * - A repeated statistic across pages (to verify deduplication)
 */
export async function generateSampleTestPdf(): Promise<Buffer> {
  if (cachedSamplePdf) {
    return cachedSamplePdf;
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Global Clean Energy & Digital Economy Brief (2026 Outlook)');
  pdfDoc.setAuthor('Meridian Strategic Insights');
  pdfDoc.setSubject('Sample Verification Document for The Fact-Check Agent');

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const navy = rgb(0.06, 0.12, 0.24);
  const blue = rgb(0.15, 0.39, 0.92);
  const slate = rgb(0.28, 0.34, 0.42);
  const bodyColor = rgb(0.12, 0.16, 0.23);
  const divider = rgb(0.85, 0.88, 0.92);

  function drawWrappedText(
    page: ReturnType<PDFDocument['addPage']>,
    text: string,
    x: number,
    startY: number,
    maxWidth: number,
    fontSize: number,
    font: typeof fontRegular,
    color = bodyColor,
    lineHeight = fontSize * 1.45
  ): number {
    const words = text.split(/\s+/);
    let line = '';
    let y = startY;

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, fontSize);
      if (width > maxWidth && line) {
        page.drawText(line, { x, y, size: fontSize, font, color });
        y -= lineHeight;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      page.drawText(line, { x, y, size: fontSize, font, color });
      y -= lineHeight;
    }
    return y;
  }

  function drawHeaderFooter(
    page: ReturnType<PDFDocument['addPage']>,
    pageNum: number,
    totalPages: number
  ) {
    const { width } = page.getSize();
    page.drawText('MERIDIAN STRATEGIC INSIGHTS  |  SAMPLE VERIFICATION BRIEF', {
      x: 54,
      y: 752,
      size: 8.5,
      font: fontBold,
      color: slate,
    });
    page.drawLine({
      start: { x: 54, y: 744 },
      end: { x: width - 54, y: 744 },
      thickness: 0.75,
      color: divider,
    });
    page.drawLine({
      start: { x: 54, y: 52 },
      end: { x: width - 54, y: 52 },
      thickness: 0.75,
      color: divider,
    });
    page.drawText('Global Clean Energy & Digital Economy Brief — Sample Audit PDF', {
      x: 54,
      y: 38,
      size: 8.5,
      font: fontRegular,
      color: slate,
    });
    page.drawText(`Page ${pageNum} of ${totalPages}`, {
      x: width - 108,
      y: 38,
      size: 8.5,
      font: fontBold,
      color: slate,
    });
  }

  // ==================== PAGE 1 ====================
  const page1 = pdfDoc.addPage([612, 792]);
  drawHeaderFooter(page1, 1, 3);

  let y = 710;
  page1.drawText('MARKET RESEARCH BRIEFING', {
    x: 54,
    y,
    size: 10,
    font: fontBold,
    color: blue,
  });
  y -= 28;

  y = drawWrappedText(
    page1,
    'Global Clean Energy & Digital Economy Brief',
    54,
    y,
    504,
    22,
    fontBold,
    navy,
    28
  );
  y -= 6;
  y = drawWrappedText(
    page1,
    'Prepared for Executive Distribution  ·  Contains deliberate accurate, outdated, false, and internal claims for fact-check testing.',
    54,
    y,
    504,
    10.5,
    fontRegular,
    slate
  );

  y -= 18;
  page1.drawText('1. Global Demographics & Climate Policy Baseline', {
    x: 54,
    y,
    size: 13.5,
    font: fontBold,
    color: navy,
  });
  y -= 20;

  y = drawWrappedText(
    page1,
    'As of today, the world population stands at 7.1 billion people, driving unprecedented urban energy demand across emerging markets. International climate coordination accelerated after the Paris Agreement was adopted in December 2015, establishing long-term goals to limit global temperature rise.',
    54,
    y,
    504,
    10.8,
    fontRegular
  );

  y -= 16;
  page1.drawText('2. Renewable Electricity & Electric Mobility Trends', {
    x: 54,
    y,
    size: 13.5,
    font: fontBold,
    color: navy,
  });
  y -= 20;

  y = drawWrappedText(
    page1,
    'Rapid solar panel cost declines have reshaped global electricity grids. According to our desk review, solar power alone accounted for 68% of total global electricity generation in 2024, surpassing coal and natural gas combined worldwide.',
    54,
    y,
    504,
    10.8,
    fontRegular
  );
  y -= 10;

  y = drawWrappedText(
    page1,
    'In automotive electrification, global electric vehicle sales reached 2.1 million units in 2024, representing a modest niche segment of passenger car registrations globally.',
    54,
    y,
    504,
    10.8,
    fontRegular
  );

  // Summary Table on Page 1
  y -= 22;
  page1.drawText('Table 1: Key Energy & Macro Indicators Cited in Brief', {
    x: 54,
    y,
    size: 11,
    font: fontBold,
    color: navy,
  });
  y -= 16;

  const tableRows: Array<[string, string, string]> = [
    ['Indicator', 'Reported Figure', 'Reference Context'],
    ['World Population', '7.1 billion people', 'Stated as current global total'],
    ['Solar Share of Global Electricity', '68% of world output', 'Calendar year 2024'],
    ['Global Electric Vehicle Sales', '2.1 million units', 'Calendar year 2024'],
    ['Paris Agreement Adoption', 'December 2015', 'UN Climate Conference (COP21)'],
  ];

  for (let i = 0; i < tableRows.length; i++) {
    const [col1, col2, col3] = tableRows[i];
    const isHeader = i === 0;
    const rowFont = isHeader ? fontBold : fontRegular;
    const rowColor = isHeader ? navy : bodyColor;

    page1.drawLine({
      start: { x: 54, y: y + 12 },
      end: { x: 558, y: y + 12 },
      thickness: isHeader ? 1.2 : 0.5,
      color: divider,
    });
    page1.drawText(col1, { x: 58, y, size: 9.5, font: rowFont, color: rowColor });
    page1.drawText(col2, { x: 245, y, size: 9.5, font: rowFont, color: rowColor });
    page1.drawText(col3, { x: 382, y, size: 9.5, font: rowFont, color: rowColor });
    y -= 20;
  }

  // ==================== PAGE 2 ====================
  const page2 = pdfDoc.addPage([612, 792]);
  drawHeaderFooter(page2, 2, 3);

  y = 708;
  page2.drawText('3. Technology & Corporate Milestones', {
    x: 54,
    y,
    size: 13.5,
    font: fontBold,
    color: navy,
  });
  y -= 20;

  y = drawWrappedText(
    page2,
    'Modern mobile computing transformed consumer internet adoption after Apple released the first iPhone in 2007. Around the same era of e-commerce expansion, Amazon was founded in 2001 in Austin, Texas by Jeff Bezos, initially operating as a cloud infrastructure vendor before expanding into books.',
    54,
    y,
    504,
    10.8,
    fontRegular
  );
  y -= 12;

  y = drawWrappedText(
    page2,
    'In digital assets, the Bitcoin protocol enforces a hard-coded maximum supply cap of 21 million bitcoins, creating a predictable issuance schedule compared to fiat currencies.',
    54,
    y,
    504,
    10.8,
    fontRegular
  );

  y -= 18;
  page2.drawText('4. Infrastructure & Engineering Benchmarks', {
    x: 54,
    y,
    size: 13.5,
    font: fontBold,
    color: navy,
  });
  y -= 20;

  y = drawWrappedText(
    page2,
    'European smart-grid telecom relays have frequently been modeled against iconic urban towers. For reference, the Eiffel Tower in Paris stands at 450 meters tall including its broadcast antenna, making it the tallest structure in France.',
    54,
    y,
    504,
    10.8,
    fontRegular
  );
  y -= 12;

  y = drawWrappedText(
    page2,
    'Meanwhile, global semiconductor manufacturing continues to require extreme ultraviolet lithography systems operating at a 13.5-nanometer wavelength for leading-edge logic nodes.',
    54,
    y,
    504,
    10.8,
    fontRegular
  );

  // ==================== PAGE 3 ====================
  const page3 = pdfDoc.addPage([612, 792]);
  drawHeaderFooter(page3, 3, 3);

  y = 708;
  page3.drawText('5. Proprietary Client Survey & Strategic Outlook', {
    x: 54,
    y,
    size: 13.5,
    font: fontBold,
    color: navy,
  });
  y -= 20;

  y = drawWrappedText(
    page3,
    'In a confidential internal Meridian Strategic Insights poll of 48 private enterprise clients conducted in October 2026, 94.2% of respondents stated they plan to increase internal sustainability compliance headcount over the next two quarters.',
    54,
    y,
    504,
    10.8,
    fontRegular
  );
  y -= 12;

  y = drawWrappedText(
    page3,
    'Reiterating our earlier macroeconomic baseline, the world population remains at 7.1 billion people, and organizations publishing investor reports should verify every demographic, energy, and corporate figure against authoritative primary data prior to publication.',
    54,
    y,
    504,
    10.8,
    fontRegular
  );

  const bytes = await pdfDoc.save();
  cachedSamplePdf = Buffer.from(bytes);
  return cachedSamplePdf;
}
