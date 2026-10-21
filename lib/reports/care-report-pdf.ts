import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { CareReport } from "@/lib/ai/care-report";

/**
 * Render the care report to a PDF with a fixed layout.
 *
 * The same report always produces the same document: sections, order, spacing,
 * and footer never vary between presses of the button. Only the text changes.
 *
 * English-only by design, so the built-in Helvetica family can be used and no
 * font file needs to be shipped. The model is instructed to answer in English;
 * any non-Latin character that still arrives is transliterated away by
 * `sanitize` rather than corrupting the document.
 */

const pageWidth = 595.28; // A4 at 72dpi
const pageHeight = 841.89;
const margin = 48;
const contentWidth = pageWidth - margin * 2;
const bodySize = 9.5;
const headingSize = 11;
const lineGap = 3.5;

const brand = rgb(0.184, 0.647, 0.557); // matches --hb-brand
const ink = rgb(0.09, 0.13, 0.16);
const muted = rgb(0.42, 0.47, 0.52);
const rule = rgb(0.85, 0.88, 0.9);
const warn = rgb(0.72, 0.35, 0.1);

// One colour per section so the document can be scanned without reading it.
const sectionColors = {
  symptoms: rgb(0.09, 0.42, 0.72), // blue
  assessment: rgb(0.78, 0.25, 0.16), // red-orange, draws attention to the impression
  tests: rgb(0.45, 0.28, 0.68), // violet
  medicalHistory: rgb(0.13, 0.52, 0.31), // green
  familyHistory: rgb(0.05, 0.45, 0.47), // teal
  concern: rgb(0.66, 0.40, 0.07), // amber
  nextSteps: rgb(0.15, 0.39, 0.68), // deep blue
} as const;

/**
 * pdf-lib's standard fonts are WinAnsi-only and throw on characters outside it,
 * so unsupported code points are replaced instead of failing the whole document.
 */
function sanitize(value: string) {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of sanitize(text).split("\n")) {
    const words = paragraph.split(" ").filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        // A single word longer than the column is broken rather than dropped.
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = "";
          for (const character of word) {
            if (font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
              lines.push(chunk);
              chunk = character;
            } else {
              chunk += character;
            }
          }
          current = chunk;
        } else {
          current = word;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

type Cursor = { page: PDFPage; y: number; pages: PDFPage[] };

function newPage(
  document: PDFDocument,
  bold: PDFFont,
  regular: PDFFont,
): Cursor {
  const page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  if (document.getPageCount() > 1) {
    page.drawText("Health-Bridge care summary", {
      x: margin,
      y: y + 7,
      size: 7.5,
      font: regular,
      color: muted,
    });
    y -= 12;
  }
  return { page, y, pages: [] };
}

function ensure(
  cursor: Cursor,
  needed: number,
  document: PDFDocument,
  bold: PDFFont,
  regular: PDFFont,
) {
  if (cursor.y - needed < margin + 30) {
    const next = newPage(document, bold, regular);
    cursor.page = next.page;
    cursor.y = next.y;
  }
}

function drawSectionHeading(
  cursor: Cursor,
  text: string,
  bold: PDFFont,
  document: PDFDocument,
  regular: PDFFont,
  color: ReturnType<typeof rgb> = brand,
) {
  ensure(cursor, 42, document, bold, regular);
  cursor.y -= 8;
  cursor.page.drawText(sanitize(text).toUpperCase(), {
    x: margin,
    y: cursor.y,
    size: headingSize,
    font: bold,
    color,
  });
  const ruleY = cursor.y - 4;
  cursor.page.drawLine({
    start: { x: margin, y: ruleY },
    end: { x: pageWidth - margin, y: ruleY },
    thickness: 0.7,
    color: rule,
  });
  cursor.y = ruleY - 11;
}

function drawParagraphs(
  cursor: Cursor,
  text: string,
  regular: PDFFont,
  document: PDFDocument,
  bold: PDFFont,
  options?: { color?: ReturnType<typeof rgb> },
) {
  const lines = wrap(text, regular, bodySize, contentWidth);
  for (const line of lines) {
    ensure(cursor, bodySize + lineGap, document, bold, regular);
    cursor.page.drawText(line, {
      x: margin,
      y: cursor.y,
      size: bodySize,
      font: regular,
      color: options?.color ?? ink,
    });
    cursor.y -= bodySize + lineGap;
  }
}

function drawBullets(
  cursor: Cursor,
  items: string[],
  regular: PDFFont,
  document: PDFDocument,
  bold: PDFFont,
  prefix = "-",
) {
  for (const item of items) {
    const lines = wrap(item, regular, bodySize, contentWidth - 14);
    lines.forEach((line, index) => {
      ensure(cursor, bodySize + lineGap, document, bold, regular);
      if (index === 0) {
        cursor.page.drawText(prefix, {
          x: margin,
          y: cursor.y,
          size: bodySize,
          font: regular,
          color: brand,
        });
      }
      cursor.page.drawText(line, {
        x: margin + 14,
        y: cursor.y,
        size: bodySize,
        font: regular,
        color: ink,
      });
      cursor.y -= bodySize + lineGap;
    });
    cursor.y -= 1.5;
  }
}

export type CareReportMeta = {
  patientName: string;
  conversationTitle: string | null;
  generatedAt: Date;
  severity: string;
  departmentName: string | null;
  referenceId: string;
};

export async function renderCareReportPdf(
  report: CareReport,
  meta: CareReportMeta,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle("Health-Bridge care summary");
  document.setProducer("Health-Bridge");
  document.setCreator("Health-Bridge");
  // Pin the timestamps to the report's own generation time so re-downloading the
  // same stored report produces a byte-identical document instead of a new file.
  document.setCreationDate(meta.generatedAt);
  document.setModificationDate(meta.generatedAt);

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);

  const cursor = newPage(document, bold, regular);

  // --- Header ---------------------------------------------------------------
  cursor.page.drawText("Health-Bridge", {
    x: margin,
    y: cursor.y,
    size: 20,
    font: bold,
    color: brand,
  });
  cursor.y -= 16;
  cursor.page.drawText("Patient care summary", {
    x: margin,
    y: cursor.y,
    size: 12,
    font: regular,
    color: muted,
  });
  cursor.y -= 20;

  const metaRows: Array<[string, string]> = [
    ["Patient", meta.patientName],
    ["Conversation", meta.conversationTitle ?? "Untitled conversation"],
    [
      "Generated",
      meta.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC",
    ],
    ["Suggested specialty", meta.departmentName ?? "Not determined"],
    ["Reference", meta.referenceId],
  ];
  for (const [label, value] of metaRows) {
    cursor.page.drawText(sanitize(label), {
      x: margin,
      y: cursor.y,
      size: 8.5,
      font: bold,
      color: muted,
    });
    cursor.page.drawText(sanitize(value), {
      x: margin + 118,
      y: cursor.y,
      size: 8.5,
      font: regular,
      color: ink,
    });
    cursor.y -= 12;
  }
  cursor.y -= 4;

  // --- Disclaimer (always immediately after the header) ---------------------
  ensure(cursor, 46, document, bold, regular);
  const disclaimerLines = wrap(
    "This document was generated by an AI intake assistant from what the patient said. It is not a diagnosis and not a medical record. Possible conditions are unverified guesses with an informal confidence estimate, not clinical probabilities. A qualified doctor must confirm every finding, test, and next step.",
    italic,
    8.5,
    contentWidth - 16,
  );
  const boxHeight = disclaimerLines.length * 11 + 12;
  cursor.page.drawRectangle({
    x: margin,
    y: cursor.y - boxHeight + 9,
    width: contentWidth,
    height: boxHeight,
    color: rgb(0.99, 0.96, 0.9),
    borderColor: warn,
    borderWidth: 0.8,
  });
  cursor.y -= 2;
  for (const line of disclaimerLines) {
    cursor.page.drawText(line, {
      x: margin + 8,
      y: cursor.y - 8,
      size: 8.5,
      font: italic,
      color: warn,
    });
    cursor.y -= 11;
  }
  cursor.y -= 14;

  // --- Symptoms | Assessment, side by side ---------------------------------
  // These two columns paginate together: when either runs out of room both
  // continue on a fresh page with the headings repeated. Content is never
  // dropped, because every symptom the patient reported must survive.
  const columnGap = 20;
  const columnWidth = (contentWidth - columnGap) / 2;
  const leftX = margin;
  const rightX = margin + columnWidth + columnGap;

  type RenderBlock = {
    lines: Array<{ text: string; font: PDFFont; size: number; color: ReturnType<typeof rgb> }>;
    lineHeight: number;
    gapAfter: number;
  };

  const blockHeight = (block: RenderBlock) =>
    block.lines.length * block.lineHeight + block.gapAfter;

  const drawBlock = (page: PDFPage, block: RenderBlock, x: number, y: number, bullet: boolean) => {
    let cursorY = y;
    block.lines.forEach((line, index) => {
      if (bullet && index === 0) {
        page.drawText("-", { x, y: cursorY, size: bodySize, font: regular, color: brand });
      }
      page.drawText(line.text, {
        x: bullet ? x + 12 : x,
        y: cursorY,
        size: line.size,
        font: line.font,
        color: line.color,
      });
      cursorY -= block.lineHeight;
    });
  };

  const leftBlocks: RenderBlock[] = (report.symptoms.length
    ? report.symptoms
    : ["No symptoms were reported in this conversation."]
  ).map((item) => ({
    lines: wrap(item, regular, bodySize, columnWidth - 12).map((text) => ({
      text, font: regular, size: bodySize, color: ink,
    })),
    lineHeight: bodySize + lineGap,
    gapAfter: 1.5,
  }));

  const rightBlocks: RenderBlock[] = report.possibleConditions.length
    ? report.possibleConditions.flatMap((condition) => {
        const headingLines = wrap(
          `${condition.condition} — ${condition.confidencePercent}% (${condition.confidenceLabel} confidence, unverified)`,
          bold,
          bodySize,
          columnWidth,
        ).map((text, index) => ({
          text,
          font: index === 0 ? bold : regular,
          size: bodySize,
          color: ink,
        }));
        const reasonLines = wrap(condition.reasoning, regular, 8.5, columnWidth).map((text) => ({
          text, font: regular, size: 8.5, color: muted,
        }));
        return [
          { lines: headingLines, lineHeight: bodySize + lineGap, gapAfter: 0 },
          { lines: reasonLines, lineHeight: 8.5 + 2.5, gapAfter: 4 },
        ];
      })
    : [{
        lines: wrap("Not enough information to suggest any possible condition.", italic, bodySize, columnWidth)
          .map((text) => ({ text, font: italic, size: bodySize, color: muted })),
        lineHeight: bodySize + lineGap,
        gapAfter: 1.5,
      }];

  const drawColumnHeadings = (page: PDFPage, y: number) => {
    page.drawText("SYMPTOMS", { x: leftX, y, size: headingSize, font: bold, color: sectionColors.symptoms });
    page.drawText("ASSESSMENT (AI IMPRESSION)", { x: rightX, y, size: headingSize, font: bold, color: sectionColors.assessment });
    page.drawLine({ start: { x: leftX, y: y - 7 }, end: { x: leftX + columnWidth, y: y - 7 }, thickness: 0.7, color: sectionColors.symptoms });
    page.drawLine({ start: { x: rightX, y: y - 7 }, end: { x: rightX + columnWidth, y: y - 7 }, thickness: 0.7, color: sectionColors.assessment });
    return y - 20;
  };

  const columnBottom = margin + 40;
  let columnPage: PDFPage = cursor.page;
  const columnTop = cursor.y;
  drawColumnHeadings(columnPage, columnTop);
  let leftY = columnTop - 20;
  let rightY = columnTop - 20;
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftBlocks.length || rightIndex < rightBlocks.length) {
    let progressed = false;

    while (leftIndex < leftBlocks.length) {
      const block = leftBlocks[leftIndex];
      const height = blockHeight(block);
      if (leftY - height < columnBottom) break;
      drawBlock(columnPage, block, leftX, leftY, true);
      leftY -= height;
      leftIndex += 1;
      progressed = true;
    }

    while (rightIndex < rightBlocks.length) {
      const block = rightBlocks[rightIndex];
      const height = blockHeight(block);
      if (rightY - height < columnBottom) break;
      drawBlock(columnPage, block, rightX, rightY, false);
      rightY -= height;
      rightIndex += 1;
      progressed = true;
    }

    if (leftIndex >= leftBlocks.length && rightIndex >= rightBlocks.length) break;

    // Start a fresh page and repeat the headings so the pairing stays legible.
    const next = newPage(document, bold, regular);
    columnPage = next.page;
    cursor.pages.push(next.page);
    leftY = drawColumnHeadings(columnPage, next.y);
    rightY = leftY;

    if (!progressed) {
      // A single block taller than a page would otherwise loop forever. Draw it
      // whole rather than silently truncating patient-reported content.
      if (leftIndex < leftBlocks.length) {
        const block = leftBlocks[leftIndex];
        drawBlock(columnPage, block, leftX, leftY, true);
        leftY -= blockHeight(block);
        leftIndex += 1;
      } else if (rightIndex < rightBlocks.length) {
        const block = rightBlocks[rightIndex];
        drawBlock(columnPage, block, rightX, rightY, false);
        rightY -= blockHeight(block);
        rightIndex += 1;
      }
    }
  }

  cursor.page = columnPage;
  cursor.y = Math.min(leftY, rightY) - 14;

  // --- Remaining fixed sections --------------------------------------------
  drawSectionHeading(cursor, "Recommended tests", bold, document, regular, sectionColors.tests);
  if (report.recommendedTests.length) {
    drawBullets(cursor, report.recommendedTests, regular, document, bold);
  } else {
    drawParagraphs(
      cursor,
      "No tests were suggested from this conversation.",
      regular,
      document,
      bold,
      { color: muted },
    );
  }

  drawSectionHeading(cursor, "Medical history", bold, document, regular, sectionColors.medicalHistory);
  if (report.medicalHistory.length) {
    drawBullets(cursor, report.medicalHistory, regular, document, bold);
  } else {
    drawParagraphs(
      cursor,
      "The patient did not report any medical history.",
      regular,
      document,
      bold,
      { color: muted },
    );
  }

  drawSectionHeading(cursor, "Family history", bold, document, regular, sectionColors.familyHistory);
  if (report.familyHistory.length) {
    drawBullets(cursor, report.familyHistory, regular, document, bold);
  } else {
    drawParagraphs(
      cursor,
      "The patient did not report any family history.",
      regular,
      document,
      bold,
      { color: muted },
    );
  }

  // Optional by design: the whole section is omitted when the patient raised
  // nothing, rather than printing an empty heading.
  if (report.patientConcern) {
    drawSectionHeading(
      cursor,
      "Patient concern or question",
      bold,
      document,
      regular,
      sectionColors.concern,
    );
    drawParagraphs(cursor, report.patientConcern, regular, document, bold);
  }

  drawSectionHeading(cursor, "Next steps", bold, document, regular, sectionColors.nextSteps);
  if (report.nextSteps.length) {
    drawBullets(cursor, report.nextSteps, regular, document, bold);
  } else {
    drawParagraphs(
      cursor,
      "Speak with a doctor about these symptoms.",
      regular,
      document,
      bold,
      { color: muted },
    );
  }

  // --- Footer on every page -------------------------------------------------
  const pages = document.getPages();
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: margin, y: margin + 22 },
      end: { x: pageWidth - margin, y: margin + 22 },
      thickness: 0.7,
      color: rule,
    });
    page.drawText("Not a diagnosis. Generated by Health-Bridge AI intake.", {
      x: margin,
      y: margin + 12,
      size: 7.5,
      font: italic,
      color: muted,
    });
    page.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: pageWidth - margin - 60,
      y: margin + 12,
      size: 7.5,
      font: regular,
      color: muted,
    });
  });

  return document.save();
}
