/**
 * Redaction (docs/ai-contracts.md, Data boundary): identifiers are replaced by
 * stable placeholders within one request (CLIENT, PERSON_1, ORGANIZATION_1,
 * PLACE_1, DATE_1). The mapping never leaves the application and is never
 * logged or sent to the provider.
 */

export interface RedactionInput {
  /** Free text that may contain identifiers. */
  text: string;
  /** Display names / emails / places to mask, longest match first. */
  identifiers?: {
    persons?: string[];
    organizations?: string[];
    places?: string[];
    dates?: string[];
  };
}

export interface RedactionResult {
  text: string;
  /** Placeholder → original. In-memory only; never persisted or logged. */
  mapping: Record<string, string>;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/gi;
const PHONE = /\+?\d[\d\s()\-]{7,}\d/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const UUID = /[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}/g;

// Letters-only sentinel: digits inside a sentinel would match PHONE and get
// redacted themselves, corrupting structural identifiers (UUIDs are not PII).
function uuidSentinel(index: number): string {
  const letters = "ABCDEFGHIJ";
  return `UUIDTOKEN${String(index)
    .split("")
    .map((digit) => letters[Number(digit)])
    .join("")}`;
}

export function redactText(input: RedactionInput): RedactionResult {
  const mapping: Record<string, string> = {};
  let text = input.text;

  // Protect UUIDs first: PHONE can match digit-and-dash runs inside a UUID and
  // corrupt identifiers that the provider must echo back (e.g. evidence refs).
  const protectedUuids: string[] = [];
  text = text.replace(UUID, (match) => {
    const sentinel = uuidSentinel(protectedUuids.length);
    protectedUuids.push(match);
    return sentinel;
  });

  const replaceAll = (original: string, placeholder: string) => {
    if (!original) return;
    mapping[placeholder] = original;
    text = text.split(original).join(placeholder);
  };

  input.identifiers?.persons?.forEach((name, index) => replaceAll(name, `PERSON_${index + 1}`));
  input.identifiers?.organizations?.forEach((name, index) =>
    replaceAll(name, `ORGANIZATION_${index + 1}`)
  );
  input.identifiers?.places?.forEach((name, index) => replaceAll(name, `PLACE_${index + 1}`));
  input.identifiers?.dates?.forEach((value, index) => replaceAll(value, `DATE_${index + 1}`));

  // Structural identifiers: emails, phones, ISO dates.
  let counter = Object.keys(mapping).length + 1;
  for (const pattern of [EMAIL, PHONE, ISO_DATE]) {
    text = text.replace(pattern, (match) => {
      const placeholder = `AUTO_${counter++}`;
      mapping[placeholder] = match;
      return placeholder;
    });
  }

  // UUIDs are structural identifiers, not PII: restore them untouched.
  protectedUuids.forEach((original, index) => {
    text = text.split(uuidSentinel(index)).join(original);
  });

  return { text, mapping };
}

/** Heuristic pre-check: does redacted text still look like it contains PII? */
export function looksUnredacted(text: string): boolean {
  // UUIDs are structural identifiers, not PII; their digit-and-dash runs would
  // otherwise false-positive on the PHONE pattern. Fresh regexes: EMAIL/PHONE
  // are global, and reusing them across .test calls is lastIndex-stateful.
  const withoutUuids = text.replace(UUID, "");
  return (
    new RegExp(EMAIL.source, "i").test(withoutUuids) || new RegExp(PHONE.source).test(withoutUuids)
  );
}
