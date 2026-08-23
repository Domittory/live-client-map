import {
  EMPTY_SECTION_TEXT,
  isEmptySection,
  REPORT_TITLE,
  type ReportBlock,
  type SnapshotReportReadModel,
} from "./model";

/**
 * Deterministic Markdown renderer (ticket 56, §13 "Markdown").
 *
 * UTF-8 CommonMark. The YAML front matter carries exactly the seven permitted
 * keys and nothing else — notably no client reference and no personal data.
 * H1 is the document title, H2 the fixed section headings. The renderer is a
 * pure function of the read model: same model in, byte-identical Markdown out.
 *
 * No raw HTML is ever produced: `&`, `<` and `>` coming from stored data are
 * emitted as character entities, so a stored `<script>` renders as text
 * instead of becoming markup.
 */

/** Front matter keys permitted by §13 — in this exact order. */
const FRONT_MATTER_KEYS = [
  "contract",
  "version",
  "export_id",
  "generated_at",
  "audience",
  "snapshot_version",
  "model_hash",
] as const;

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Table cells additionally escape the column separator and drop line breaks. */
function escapeCell(value: string): string {
  return escapeText(value)
    .replaceAll("|", "\\|")
    .replace(/\s*\r?\n\s*/g, " ")
    .trim();
}

function yamlScalar(value: string | number): string {
  if (typeof value === "number") return String(value);
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function renderBlock(block: ReportBlock): string[] {
  switch (block.kind) {
    case "paragraph":
      return [escapeText(block.text)];
    case "list":
      return block.items.map((item) => `- ${escapeText(item)}`);
    case "fields":
      return block.fields.map(
        (field) => `- **${escapeText(field.label)}:** ${escapeText(field.value)}`
      );
    case "table": {
      const header = `| ${block.columns.map(escapeCell).join(" | ")} |`;
      const divider = `| ${block.columns.map(() => "---").join(" | ")} |`;
      const rows = block.rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
      return [header, divider, ...rows];
    }
  }
}

/** Render the read model as CommonMark (§13). Pure and deterministic. */
export function renderReportMarkdown(model: SnapshotReportReadModel): string {
  const frontMatter: Record<(typeof FRONT_MATTER_KEYS)[number], string | number> = {
    contract: model.contract,
    version: model.version,
    export_id: model.export_id,
    generated_at: model.generated_at,
    audience: model.audience,
    snapshot_version: model.snapshot_version,
    model_hash: model.model_hash,
  };

  const lines: string[] = ["---"];
  for (const key of FRONT_MATTER_KEYS) {
    lines.push(`${key}: ${yamlScalar(frontMatter[key])}`);
  }
  lines.push("---", "", `# ${REPORT_TITLE}`, "");

  for (const section of model.sections) {
    lines.push(`## ${section.heading}`, "");
    if (isEmptySection(section)) {
      lines.push(EMPTY_SECTION_TEXT, "");
      continue;
    }
    for (const block of section.blocks) {
      const rendered = renderBlock(block);
      if (rendered.length === 0) continue;
      lines.push(...rendered, "");
    }
  }

  // Exactly one trailing newline, no trailing blank lines.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}
