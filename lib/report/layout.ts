import {
  EMPTY_SECTION_TEXT,
  isEmptySection,
  REPORT_TITLE,
  type ReportBlock,
  type SnapshotReportReadModel,
} from "./model";

/**
 * PDF layout engine (ticket 56, §13 "PDF").
 *
 * The whole pagination decision is a PURE function of the read model plus a
 * text-measuring callback, so the rules that matter — a heading never ends a
 * page, long text wraps instead of being clipped, a table row is never split —
 * are unit-testable without parsing PDF bytes. `lib/report/pdf.ts` only turns
 * the resulting pages into drawing commands.
 *
 * Widow control works through "keep groups": a line marked `keepWithNext` is
 * bound to the line after it, and a maximal run of bound lines moves to the
 * next page as a unit. A heading is therefore always followed by at least its
 * first line of content, and a table header always by its first full row.
 */

export interface LayoutMetrics {
  pageWidth: number;
  pageHeight: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** Reserved strip at the bottom for the footer (page number + export ref). */
  footerHeight: number;
  titleSize: number;
  headingSize: number;
  bodySize: number;
  footerSize: number;
  lineHeightRatio: number;
  paragraphGap: number;
  sectionGap: number;
  indentStep: number;
  /** Horizontal gutter between table columns. */
  columnGap: number;
}

/** A4 portrait in PostScript points, ~2 cm margins (§13: A4, readable margins). */
export const A4_PORTRAIT: LayoutMetrics = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  marginTop: 56,
  marginRight: 56,
  marginBottom: 48,
  marginLeft: 56,
  footerHeight: 28,
  titleSize: 18,
  headingSize: 13,
  bodySize: 10,
  footerSize: 8,
  lineHeightRatio: 1.35,
  paragraphGap: 6,
  sectionGap: 14,
  indentStep: 12,
  columnGap: 8,
};

/** Width of `text` when drawn at `size` in the regular or bold face. */
export type MeasureText = (text: string, size: number, bold: boolean) => number;

export interface PlannedCell {
  text: string;
  /** Offset from the left text edge, in points. */
  x: number;
  width: number;
}

export interface PlannedLine {
  size: number;
  bold: boolean;
  /** Left indent from the text edge, in points. */
  indent: number;
  /** Vertical gap inserted above this line; dropped at the top of a page. */
  spaceBefore: number;
  /** Bind this line to the following one — they never straddle a page break. */
  keepWithNext: boolean;
  /** Plain text line. Mutually exclusive with `cells`. */
  text?: string;
  /** Table row line. Mutually exclusive with `text`. */
  cells?: PlannedCell[];
}

export interface PlannedPage {
  lines: PlannedLine[];
}

export function lineHeight(size: number, metrics: LayoutMetrics): number {
  return size * metrics.lineHeightRatio;
}

function contentWidth(metrics: LayoutMetrics): number {
  return metrics.pageWidth - metrics.marginLeft - metrics.marginRight;
}

/**
 * Break `text` into lines that fit `maxWidth`. A single word wider than the
 * column is split character by character rather than clipped (§13: long text
 * must wrap without truncation).
 */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  bold: boolean,
  measure: MeasureText
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const out: string[] = [];
  // Widths are accumulated per word rather than by re-measuring the growing
  // line: a real font measurement shapes the whole string, so re-measuring
  // every prefix turns wrapping into a quadratic, and very slow, operation.
  const spaceWidth = measure(" ", size, bold);

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      out.push("");
      continue;
    }

    let current = "";
    let currentWidth = 0;
    const flush = () => {
      if (current.length > 0) {
        out.push(current);
        current = "";
        currentWidth = 0;
      }
    };

    for (const word of words) {
      const wordWidth = measure(word, size, bold);
      const candidateWidth =
        current.length === 0 ? wordWidth : currentWidth + spaceWidth + wordWidth;
      if (candidateWidth <= maxWidth) {
        current = current.length === 0 ? word : `${current} ${word}`;
        currentWidth = candidateWidth;
        continue;
      }
      flush();
      if (wordWidth <= maxWidth) {
        current = word;
        currentWidth = wordWidth;
        continue;
      }
      // Word wider than the whole column — hard split, never clip.
      let chunk = "";
      let chunkWidth = 0;
      for (const char of word) {
        const charWidth = measure(char, size, bold);
        if (chunk.length > 0 && chunkWidth + charWidth > maxWidth) {
          out.push(chunk);
          chunk = char;
          chunkWidth = charWidth;
        } else {
          chunk += char;
          chunkWidth += charWidth;
        }
      }
      current = chunk;
      currentWidth = chunkWidth;
    }
    flush();
  }

  return out.length > 0 ? out : [""];
}

function textLines(
  text: string,
  options: {
    size: number;
    bold: boolean;
    indent: number;
    spaceBefore: number;
    keepWithNext?: boolean;
  },
  metrics: LayoutMetrics,
  measure: MeasureText
): PlannedLine[] {
  const width = contentWidth(metrics) - options.indent;
  const wrapped = wrapText(text, width, options.size, options.bold, measure);
  return wrapped.map((line, index) => ({
    text: line,
    size: options.size,
    bold: options.bold,
    indent: options.indent,
    spaceBefore: index === 0 ? options.spaceBefore : 0,
    // Bind every wrapped fragment of a heading together, and the last one to
    // the content line that follows it.
    keepWithNext: options.keepWithNext ?? false,
  }));
}

function tableLines(
  block: Extract<ReportBlock, { kind: "table" }>,
  metrics: LayoutMetrics,
  measure: MeasureText
): PlannedLine[] {
  const columns = block.columns.length;
  if (columns === 0) return [];

  const total = contentWidth(metrics);
  const columnWidth = (total - metrics.columnGap * (columns - 1)) / columns;
  const offsets = block.columns.map((_, index) => index * (columnWidth + metrics.columnGap));

  const renderRow = (cells: string[], bold: boolean, spaceBefore: number): PlannedLine[] => {
    const wrapped = cells.map((cell) =>
      wrapText(cell, columnWidth, metrics.bodySize, bold, measure)
    );
    const height = Math.max(...wrapped.map((lines) => lines.length));
    const out: PlannedLine[] = [];
    for (let row = 0; row < height; row += 1) {
      out.push({
        size: metrics.bodySize,
        bold,
        indent: 0,
        spaceBefore: row === 0 ? spaceBefore : 0,
        // All fragments of one row stay together; the final fragment binds to
        // the next row only for the header, so a header never ends a page.
        keepWithNext: row < height - 1,
        cells: wrapped.map((lines, column) => ({
          text: lines[row] ?? "",
          x: offsets[column],
          width: columnWidth,
        })),
      });
    }
    return out;
  };

  const header = renderRow(block.columns, true, metrics.paragraphGap);
  if (header.length > 0) header[header.length - 1].keepWithNext = true;

  const body = block.rows.flatMap((row) => {
    const cells = block.columns.map((_, index) => row[index] ?? "");
    return renderRow(cells, false, 0);
  });

  return [...header, ...body];
}

function blockLines(
  block: ReportBlock,
  metrics: LayoutMetrics,
  measure: MeasureText
): PlannedLine[] {
  switch (block.kind) {
    case "paragraph":
      return textLines(
        block.text,
        { size: metrics.bodySize, bold: false, indent: 0, spaceBefore: metrics.paragraphGap },
        metrics,
        measure
      );
    case "list":
      return block.items.flatMap((item) =>
        textLines(
          `• ${item}`,
          {
            size: metrics.bodySize,
            bold: false,
            indent: metrics.indentStep,
            spaceBefore: 2,
          },
          metrics,
          measure
        )
      );
    case "fields":
      return block.fields.flatMap((field) =>
        textLines(
          `${field.label}: ${field.value}`,
          {
            size: metrics.bodySize,
            bold: false,
            indent: metrics.indentStep,
            spaceBefore: 2,
          },
          metrics,
          measure
        )
      );
    case "table":
      return tableLines(block, metrics, measure);
  }
}

/** Flatten the read model into a single ordered stream of lines. */
export function flattenReport(
  model: SnapshotReportReadModel,
  metrics: LayoutMetrics,
  measure: MeasureText
): PlannedLine[] {
  const lines: PlannedLine[] = [
    ...textLines(
      REPORT_TITLE,
      { size: metrics.titleSize, bold: true, indent: 0, spaceBefore: 0, keepWithNext: true },
      metrics,
      measure
    ),
  ];

  for (const section of model.sections) {
    lines.push(
      ...textLines(
        section.heading,
        {
          size: metrics.headingSize,
          bold: true,
          indent: 0,
          spaceBefore: metrics.sectionGap,
          keepWithNext: true,
        },
        metrics,
        measure
      )
    );

    if (isEmptySection(section)) {
      lines.push(
        ...textLines(
          EMPTY_SECTION_TEXT,
          { size: metrics.bodySize, bold: false, indent: 0, spaceBefore: metrics.paragraphGap },
          metrics,
          measure
        )
      );
      continue;
    }

    for (const block of section.blocks) {
      lines.push(...blockLines(block, metrics, measure));
    }
  }

  return lines;
}

/**
 * Split the stream into keep groups: a maximal run in which every line but the
 * last is bound to its successor.
 */
function buildGroups(lines: PlannedLine[]): PlannedLine[][] {
  const groups: PlannedLine[][] = [];
  let current: PlannedLine[] = [];
  for (const line of lines) {
    current.push(line);
    if (!line.keepWithNext) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Paginate a flattened line stream, honouring keep groups. */
export function paginate(lines: PlannedLine[], metrics: LayoutMetrics): PlannedPage[] {
  const available =
    metrics.pageHeight - metrics.marginTop - metrics.marginBottom - metrics.footerHeight;

  const pages: PlannedPage[] = [];
  let current: PlannedLine[] = [];
  let used = 0;

  const flush = () => {
    if (current.length > 0) {
      pages.push({ lines: current });
      current = [];
      used = 0;
    }
  };

  const place = (line: PlannedLine) => {
    const spaceBefore = current.length === 0 ? 0 : line.spaceBefore;
    const height = spaceBefore + lineHeight(line.size, metrics);
    if (current.length > 0 && used + height > available) {
      flush();
      place(line);
      return;
    }
    current.push(spaceBefore === line.spaceBefore ? line : { ...line, spaceBefore });
    used += height;
  };

  for (const group of buildGroups(lines)) {
    const groupHeight = group.reduce((sum, line, index) => {
      const spaceBefore = current.length === 0 && index === 0 ? 0 : line.spaceBefore;
      return sum + spaceBefore + lineHeight(line.size, metrics);
    }, 0);

    // The group does not fit in the remaining space: start a new page, unless
    // the group is taller than a whole page — then it is placed line by line
    // and allowed to span pages, because dropping content is never an option.
    if (current.length > 0 && used + groupHeight > available && groupHeight <= available) {
      flush();
    }
    for (const line of group) place(line);
  }

  flush();
  return pages.length > 0 ? pages : [{ lines: [] }];
}

/** Full layout: read model → paginated lines ready to be drawn. */
export function layoutReport(
  model: SnapshotReportReadModel,
  measure: MeasureText,
  metrics: LayoutMetrics = A4_PORTRAIT
): PlannedPage[] {
  return paginate(flattenReport(model, metrics, measure), metrics);
}
