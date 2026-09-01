import { createHash } from "node:crypto";
import { canonicalizeNewlines } from "../path/lineEnding.js";

const OPEN = /<!--\s*docforce:ai-section\s+id="([^"]+)"\s*-->/g;
const CLOSE = /<!--\s*\/docforce:ai-section\s*-->/g;

export interface ManagedSection {
  readonly id: string;
  readonly innerContent: string;
  readonly fullMatch: string;
  readonly start: number;
  readonly end: number;
  /** Index of the first character after the opening marker. */
  readonly innerStart: number;
  /** Index of the closing marker (inner content ends here). */
  readonly innerEnd: number;
}

export interface SectionParseResult {
  readonly valid: boolean;
  readonly sections: readonly ManagedSection[];
  readonly errors: readonly string[];
}

export function hashContent(content: string): string {
  return createHash("sha256").update(canonicalizeNewlines(content), "utf-8").digest("hex");
}

export function parseManagedSections(markdown: string): SectionParseResult {
  const errors: string[] = [];
  const sections: ManagedSection[] = [];
  const ids = new Set<string>();

  const opens: { id: string; index: number; markerEnd: number }[] = [];
  const closes: { index: number; markerEnd: number }[] = [];

  OPEN.lastIndex = 0;
  CLOSE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = OPEN.exec(markdown)) !== null) {
    opens.push({ id: m[1]!, index: m.index, markerEnd: m.index + m[0].length });
  }
  while ((m = CLOSE.exec(markdown)) !== null) {
    closes.push({ index: m.index, markerEnd: m.index + m[0].length });
  }

  if (opens.length !== closes.length) {
    errors.push("Malformed DocForce AI section markers: unmatched open/close tags");
    return { valid: false, sections: [], errors };
  }

  for (let i = 0; i < opens.length; i++) {
    const open = opens[i]!;
    const close = closes[i]!;
    if (close.index <= open.markerEnd) {
      errors.push(`Malformed section markers around id="${open.id}"`);
      continue;
    }
    const nextOpen = opens[i + 1];
    if (nextOpen && nextOpen.index < close.index) {
      errors.push(`Nested DocForce AI sections are not allowed (id="${open.id}")`);
      continue;
    }
    if (ids.has(open.id)) {
      errors.push(`Duplicate DocForce AI section id "${open.id}"`);
      continue;
    }
    ids.add(open.id);
    const innerContent = markdown.slice(open.markerEnd, close.index);
    const fullMatch = markdown.slice(open.index, close.markerEnd);
    sections.push({
      id: open.id,
      innerContent,
      fullMatch,
      start: open.index,
      end: close.markerEnd,
      innerStart: open.markerEnd,
      innerEnd: close.index,
    });
  }

  return { valid: errors.length === 0, sections, errors };
}

export function findSection(markdown: string, sectionId: string): ManagedSection | undefined {
  const parsed = parseManagedSections(markdown);
  if (!parsed.valid) return undefined;
  return parsed.sections.find((s) => s.id === sectionId);
}

export function wrapSection(sectionId: string, inner: string): string {
  const body = inner.endsWith("\n") ? inner : `${inner}\n`;
  return `<!-- docforce:ai-section id="${sectionId}" -->\n${body}<!-- /docforce:ai-section -->`;
}

/**
 * Replace only the inner text of a managed section. Opening/closing markers
 * and all surrounding document text are preserved byte-for-byte.
 */
export function replaceManagedInner(
  markdown: string,
  sectionId: string,
  newInner: string,
): { ok: true; markdown: string } | { ok: false; error: string } {
  const parsed = parseManagedSections(markdown);
  if (!parsed.valid) {
    return { ok: false, error: parsed.errors.join("; ") };
  }
  const section = parsed.sections.find((s) => s.id === sectionId);
  if (!section) {
    return { ok: false, error: `Managed section "${sectionId}" not found` };
  }
  const inner = newInner.endsWith("\n") ? newInner : `${newInner}\n`;
  return {
    ok: true,
    markdown: markdown.slice(0, section.innerStart) + inner + markdown.slice(section.innerEnd),
  };
}

/**
 * Append a new managed section at the end of an existing document.
 */
export function appendManagedSection(markdown: string, sectionId: string, inner: string): string {
  const block = wrapSection(sectionId, inner);
  const base = markdown.replace(/\s*$/, "");
  return `${base}\n\n${block}\n`;
}

export function isProposalStale(oldContentHash: string | undefined, currentContent: string | undefined): boolean {
  const current = hashContent(currentContent ?? "");
  return (oldContentHash ?? hashContent("")) !== current;
}
