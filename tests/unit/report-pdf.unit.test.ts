import { writeFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { A4_PORTRAIT } from "@/lib/report/layout";
import {
  REPORT_CONTRACT,
  REPORT_CONTRACT_VERSION,
  REPORT_DISCLAIMER,
  REPORT_SECTION_HEADINGS,
  REPORT_SECTION_KEYS,
  REPORT_TITLE,
  type ReportBlock,
  type SnapshotReportReadModel,
} from "@/lib/report/model";
import { renderReportPdf } from "@/lib/report/pdf";

/**
 * Ticket 56, §13 "PDF". These assertions stand in for manual visual QA of the
 * canonical fixture: they prove the document really is a PDF, that the
 * Cyrillic-capable font is embedded and subset, that long Russian text spills
 * onto further pages instead of being clipped, and that no client name reaches
 * the document properties.
 */

const CLIENT_REF = "0123456789abcdef";

/** Embedding and subsetting the font costs seconds; the 5s default is too tight. */
const PDF_TEST_TIMEOUT_MS = 45_000;

function fixtureModel(): SnapshotReportReadModel {
  const filled: Partial<Record<string, ReportBlock[]>> = {
    client: [{ kind: "fields", fields: [{ label: "Обращение", value: "Клиент А." }] }],
    snapshot_summary: [
      {
        kind: "paragraph",
        text:
          "Сводка модели за период наблюдения: устойчивость выросла, тревожная реакция " +
          "на рабочие ситуации ослабла, появилась новая опора в отношениях. ".repeat(6),
      },
    ],
    active_themes: [
      {
        kind: "table",
        columns: ["Тема", "Статус", "Активность", "Уверенность", "Тренд"],
        rows: Array.from({ length: 14 }, (_, index) => [
          `Тема номер ${index + 1} — избегание близости и контроль`,
          "active",
          String(50 + index),
          String(60 + index),
          "растёт",
        ]),
      },
    ],
    core_hypotheses: [
      {
        kind: "paragraph",
        text: "Гипотеза: страх отвержения поддерживается ранним опытом критики. ".repeat(8),
      },
    ],
    disclaimer: [{ kind: "paragraph", text: REPORT_DISCLAIMER }],
  };

  return {
    contract: REPORT_CONTRACT,
    version: REPORT_CONTRACT_VERSION,
    export_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    generated_at: "2026-08-23T10:00:00.000Z",
    audience: "specialist",
    snapshot_version: 12,
    model_hash: "f".repeat(64),
    client_ref: CLIENT_REF,
    sections: REPORT_SECTION_KEYS.map((key) => ({
      key,
      heading: REPORT_SECTION_HEADINGS[key],
      blocks: filled[key] ?? [],
    })),
  };
}

describe("renderReportPdf (ticket 56, §13)", () => {
  it(
    "produces a valid multi-page PDF matching the planned layout",
    async () => {
      const model = fixtureModel();
      const bytes = await renderReportPdf(model);

      expect(bytes.byteLength).toBeGreaterThan(1000);
      expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");

      // Reproducible visual QA: `REPORT_FIXTURE_OUT=/path/report.pdf pnpm
      // test:unit` writes the canonical fixture out so a human can look at the
      // real rendering — Cyrillic, pagination, tables and footer.
      const fixtureOut = process.env.REPORT_FIXTURE_OUT;
      if (fixtureOut) writeFileSync(fixtureOut, bytes);

      // Real pagination uses the embedded font's metrics; the rules themselves
      // are covered in report.unit.test.ts against an injected measurer. Here we
      // only need the long Russian fixture to actually spill onto further pages.
      const parsed = await PDFDocument.load(bytes);
      expect(parsed.getPageCount()).toBeGreaterThan(1);

      const { width, height } = parsed.getPage(0).getSize();
      expect(Math.round(width)).toBe(Math.round(A4_PORTRAIT.pageWidth));
      expect(Math.round(height)).toBe(Math.round(A4_PORTRAIT.pageHeight));
    },
    PDF_TEST_TIMEOUT_MS
  );

  it(
    "embeds the Cyrillic font instead of relying on a standard PDF face",
    async () => {
      const parsed = await PDFDocument.load(await renderReportPdf(fixtureModel()));
      const fonts = parsed.getPage(0).node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
      expect(fonts).toBeDefined();

      const baseFonts = (fonts?.entries() ?? []).map(([, ref]) => {
        const font = parsed.context.lookupMaybe(ref, PDFDict);
        return font?.get(PDFName.of("BaseFont"))?.toString() ?? "";
      });

      // A composite (Type0) font whose BaseFont is the vendored Noto Sans subset:
      // the glyphs travel inside the file, so Cyrillic does not depend on the
      // reader having a suitable font installed.
      expect(baseFonts.join(" ")).toContain("NotoSans");
      expect(baseFonts.length).toBeGreaterThanOrEqual(1);
    },
    PDF_TEST_TIMEOUT_MS
  );

  it(
    "keeps client identity out of the document properties",
    async () => {
      const model = fixtureModel();
      const parsed = await PDFDocument.load(await renderReportPdf(model));

      expect(parsed.getTitle()).toBe(`${REPORT_TITLE} ${CLIENT_REF}`);
      expect(parsed.getTitle()).not.toContain("Клиент А.");
      expect(parsed.getAuthor()).toBe("Living Client Map");
      // Deterministic stamp taken from the read model, not from the clock.
      expect(parsed.getCreationDate()?.toISOString()).toBe(model.generated_at);
    },
    PDF_TEST_TIMEOUT_MS
  );

  it(
    "renders a report whose sections are all empty without failing",
    async () => {
      const empty: SnapshotReportReadModel = {
        ...fixtureModel(),
        sections: REPORT_SECTION_KEYS.map((key) => ({
          key,
          heading: REPORT_SECTION_HEADINGS[key],
          blocks: [],
        })),
      };
      const parsed = await PDFDocument.load(await renderReportPdf(empty));
      expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    },
    PDF_TEST_TIMEOUT_MS
  );
});
