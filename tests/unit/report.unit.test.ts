import { describe, expect, it } from "vitest";
import {
  A4_PORTRAIT,
  flattenReport,
  layoutReport,
  lineHeight,
  paginate,
  wrapText,
  type LayoutMetrics,
  type MeasureText,
  type PlannedPage,
} from "@/lib/report/layout";
import { renderReportMarkdown } from "@/lib/report/markdown";
import {
  EMPTY_SECTION_TEXT,
  REPORT_CONTRACT,
  REPORT_CONTRACT_VERSION,
  REPORT_SECTION_HEADINGS,
  REPORT_SECTION_KEYS,
  type ReportBlock,
  type ReportSection,
  type SnapshotReportReadModel,
} from "@/lib/report/model";
import { opaqueClientRef } from "@/lib/service/report";

/**
 * Ticket 56. The renderers and the PDF layout engine are pure, so the rules
 * that §13 actually cares about — fixed layout, no silent omission, no raw
 * HTML, pagination that never orphans a heading or splits a table row — are
 * tested here directly, without a database and without parsing PDF bytes.
 */

/** Predictable text metrics: every glyph is half the font size wide. */
const measure: MeasureText = (text, size) => text.length * size * 0.5;

function makeModel(blocks: Partial<Record<string, ReportBlock[]>> = {}): SnapshotReportReadModel {
  const sections: ReportSection[] = REPORT_SECTION_KEYS.map((key) => ({
    key,
    heading: REPORT_SECTION_HEADINGS[key],
    blocks: blocks[key] ?? [],
  }));
  return {
    contract: REPORT_CONTRACT,
    version: REPORT_CONTRACT_VERSION,
    export_id: "11111111-2222-3333-4444-555555555555",
    generated_at: "2026-08-23T10:00:00.000Z",
    audience: "specialist",
    snapshot_version: 7,
    model_hash: "a".repeat(64),
    client_ref: "0123456789abcdef",
    sections,
  };
}

describe("renderReportMarkdown (ticket 56, §13)", () => {
  it("emits exactly the seven permitted front matter keys", () => {
    const markdown = renderReportMarkdown(makeModel());
    const frontMatter = markdown.split("---")[1];
    const keys = frontMatter
      .trim()
      .split("\n")
      .map((line) => line.split(":")[0]);

    expect(keys).toEqual([
      "contract",
      "version",
      "export_id",
      "generated_at",
      "audience",
      "snapshot_version",
      "model_hash",
    ]);
    // The client reference is deliberately absent from the front matter.
    expect(frontMatter).not.toContain("client_ref");
  });

  it("renders all fourteen sections in the fixed contract order", () => {
    const markdown = renderReportMarkdown(makeModel());
    const headings = markdown
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3));

    expect(headings).toEqual(REPORT_SECTION_KEYS.map((key) => REPORT_SECTION_HEADINGS[key]));
    expect(headings).toHaveLength(14);
  });

  it("prints an empty section instead of dropping it", () => {
    const markdown = renderReportMarkdown(makeModel());
    const emptyCount = markdown.split(EMPTY_SECTION_TEXT).length - 1;
    expect(emptyCount).toBe(14);
  });

  it("never emits raw HTML from stored data", () => {
    const markdown = renderReportMarkdown(
      makeModel({
        client: [{ kind: "paragraph", text: "<script>alert('x')</script> & <b>bold</b>" }],
      })
    );
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("<b>");
    expect(markdown).toContain("&lt;script&gt;");
  });

  it("escapes the column separator inside table cells", () => {
    const markdown = renderReportMarkdown(
      makeModel({
        active_themes: [{ kind: "table", columns: ["Тема"], rows: [["Контроль | Тревога"]] }],
      })
    );
    expect(markdown).toContain("Контроль \\| Тревога");
  });

  it("is deterministic — the same model renders byte-identically", () => {
    const model = makeModel({ resources: [{ kind: "list", items: ["Опора", "Смысл"] }] });
    expect(renderReportMarkdown(model)).toBe(renderReportMarkdown(model));
  });
});

describe("wrapText (ticket 56, §13: long text wraps, never clips)", () => {
  it("breaks a long line on word boundaries", () => {
    const lines = wrapText("один два три четыре пять", 40, 10, false, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measure(line, 10, false)).toBeLessThanOrEqual(40);
    }
  });

  it("hard-splits a word wider than the column rather than clipping it", () => {
    const word = "ы".repeat(60);
    const lines = wrapText(word, 50, 10, false, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(word);
    for (const line of lines) {
      expect(measure(line, 10, false)).toBeLessThanOrEqual(50);
    }
  });
});

/** Narrow, short page so pagination is exercised with little content. */
const TIGHT: LayoutMetrics = {
  ...A4_PORTRAIT,
  pageHeight: 260,
  pageWidth: 300,
};

function lastLine(page: PlannedPage) {
  return page.lines[page.lines.length - 1];
}

describe("paginate (ticket 56, §13: pagination rules)", () => {
  const longBody: ReportBlock[] = [
    { kind: "paragraph", text: "Повторяющийся текст для переноса. ".repeat(12) },
  ];

  const model = makeModel({
    client: longBody,
    requests_goals: longBody,
    snapshot_summary: longBody,
    active_themes: [
      {
        kind: "table",
        columns: ["Тема", "Статус"],
        rows: Array.from({ length: 8 }, (_, index) => [
          `Тема с довольно длинным названием ${index}`,
          "active",
        ]),
      },
    ],
    core_hypotheses: longBody,
    evidence: longBody,
  });

  const pages = layoutReport(model, measure, TIGHT);

  it("produces more than one page for long content", () => {
    expect(pages.length).toBeGreaterThan(1);
  });

  it("never leaves a heading — or a table header — as the last line of a page", () => {
    for (const page of pages.slice(0, -1)) {
      expect(page.lines.length).toBeGreaterThan(0);
      // A bound line is one that must be followed by its successor; finding one
      // at the end of a page means a heading or table header was orphaned.
      expect(lastLine(page).keepWithNext).toBe(false);
    }
  });

  it("loses no lines while paginating", () => {
    const flat = flattenReport(model, TIGHT, measure);
    const paginated = pages.reduce((sum, page) => sum + page.lines.length, 0);
    expect(paginated).toBe(flat.length);
  });

  it("keeps every page inside the printable height", () => {
    const available = TIGHT.pageHeight - TIGHT.marginTop - TIGHT.marginBottom - TIGHT.footerHeight;
    for (const page of pages) {
      const used = page.lines.reduce(
        (sum, line) => sum + line.spaceBefore + lineHeight(line.size, TIGHT),
        0
      );
      expect(used).toBeLessThanOrEqual(available + 0.001);
    }
  });

  it("drops the leading gap at the top of a page", () => {
    for (const page of pages) {
      expect(page.lines[0].spaceBefore).toBe(0);
    }
  });

  it("keeps a group taller than a whole page instead of discarding it", () => {
    const giant = makeModel({
      client: [{ kind: "paragraph", text: "слово ".repeat(400) }],
    });
    const flat = flattenReport(giant, TIGHT, measure);
    const result = paginate(flat, TIGHT);
    const total = result.reduce((sum, page) => sum + page.lines.length, 0);
    expect(total).toBe(flat.length);
  });
});

describe("content equality between renderings (ticket 56, §13)", () => {
  it("Markdown and the PDF layout carry the same section headings", () => {
    const model = makeModel({
      resources: [{ kind: "list", items: ["Поддержка близких"] }],
    });
    const markdown = renderReportMarkdown(model);
    const pdfText = layoutReport(model, measure, A4_PORTRAIT)
      .flatMap((page) => page.lines)
      .map((line) => line.text ?? (line.cells ?? []).map((cell) => cell.text).join(" "))
      .join("\n");

    for (const key of REPORT_SECTION_KEYS) {
      const heading = REPORT_SECTION_HEADINGS[key];
      expect(markdown).toContain(heading);
      expect(pdfText).toContain(heading);
    }
    expect(pdfText).toContain("Поддержка близких");
  });
});

describe("opaqueClientRef (ticket 56, §10: no identifiers in filenames)", () => {
  it("is stable and never exposes the client id", () => {
    const clientId = "9f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f";
    const ref = opaqueClientRef(clientId);
    expect(ref).toBe(opaqueClientRef(clientId));
    expect(ref).toHaveLength(16);
    expect(ref).not.toContain(clientId);
    expect(opaqueClientRef("2f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f")).not.toBe(ref);
  });
});
