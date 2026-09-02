export const PUBLICATION_SECTION_IDS = [
  "executive-summary",
  "system-context",
  "architecture-overview",
  "software-architecture",
  "technology-stack",
  "api-architecture",
  "data-architecture",
  "external-integrations",
  "device-architecture",
  "deployment-architecture",
  "runtime-configuration",
  "documentation-coverage",
  "unknowns",
  "appendix-technology",
  "appendix-api",
  "appendix-configuration",
] as const;

export type PublicationSectionId = (typeof PUBLICATION_SECTION_IDS)[number];

export const PUBLICATION_BLOCK_KINDS = [
  "paragraph",
  "table",
  "figure",
  "bullet-list",
  "callout",
  "page-break",
] as const;

export type PublicationBlockKind = (typeof PUBLICATION_BLOCK_KINDS)[number];

export const CALLOUT_TONES = ["coverage", "unknown", "limitation"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export const FIGURE_KINDS = [
  "system-overview",
  "software-architecture",
  "data-architecture",
  "device-architecture",
  "deployment-architecture",
] as const;

export type PublicationFigureKind = (typeof FIGURE_KINDS)[number];

export interface PublicationMetadata {
  readonly productName: string;
  readonly productType: string;
  readonly organizationName: string;
  readonly documentTitle: string;
  readonly classification: string;
  readonly status: string;
  readonly evidenceStatement: string;
  readonly coverageNote: string;
  readonly includeOperationalProvenance: boolean;
}

export interface PublicationCover {
  readonly organizationName: string;
  readonly logoPath?: string;
  readonly productName: string;
  readonly documentTitle: string;
  readonly classification?: string;
  readonly status?: string;
  readonly evidenceStatement: string;
}

export interface PublicationInfoRow {
  readonly label: string;
  readonly value: string;
}

export interface PublicationParagraph {
  readonly kind: "paragraph";
  readonly text: string;
}

export interface PublicationTable {
  readonly kind: "table";
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface PublicationFigure {
  readonly kind: "figure";
  readonly figureKind: PublicationFigureKind;
  readonly number: number;
  readonly caption: string;
  readonly mermaidSource: string;
  readonly pngPath?: string;
  readonly svgPath?: string;
}

export interface PublicationBulletList {
  readonly kind: "bullet-list";
  readonly items: readonly string[];
}

export interface PublicationCallout {
  readonly kind: "callout";
  readonly tone: CalloutTone;
  readonly title: string;
  readonly text: string;
}

export interface PublicationPageBreak {
  readonly kind: "page-break";
}

export type PublicationBlock =
  | PublicationParagraph
  | PublicationTable
  | PublicationFigure
  | PublicationBulletList
  | PublicationCallout
  | PublicationPageBreak;

export interface PublicationSection {
  readonly id: PublicationSectionId;
  readonly title: string;
  readonly level: 1 | 2;
  readonly appendix: boolean;
  readonly blocks: readonly PublicationBlock[];
}

export interface PublicationDocument {
  readonly metadata: PublicationMetadata;
  readonly cover: PublicationCover;
  readonly information: readonly PublicationInfoRow[];
  readonly sections: readonly PublicationSection[];
}

export function figureCaption(kind: PublicationFigureKind, number: number): string {
  switch (kind) {
    case "system-overview":
      return `Figure ${number} — System Architecture`;
    case "software-architecture":
      return `Figure ${number} — Software Architecture`;
    case "data-architecture":
      return `Figure ${number} — Data Architecture`;
    case "device-architecture":
      return `Figure ${number} — Device & Peripheral Architecture`;
    case "deployment-architecture":
      return `Figure ${number} — Deployment Architecture`;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function collectPublicationText(doc: PublicationDocument): string {
  const parts: string[] = [
    doc.metadata.productName,
    doc.metadata.documentTitle,
    doc.metadata.organizationName,
    doc.cover.evidenceStatement,
  ];
  for (const row of doc.information) {
    parts.push(row.label, row.value);
  }
  for (const section of doc.sections) {
    parts.push(section.title);
    for (const block of section.blocks) {
      switch (block.kind) {
        case "paragraph":
          parts.push(block.text);
          break;
        case "table":
          parts.push(...block.headers, ...block.rows.flat());
          break;
        case "figure":
          parts.push(block.caption);
          break;
        case "bullet-list":
          parts.push(...block.items);
          break;
        case "callout":
          parts.push(block.title, block.text);
          break;
        case "page-break":
          break;
        default: {
          const exhaustive: never = block;
          return exhaustive;
        }
      }
    }
  }
  return parts.join("\n");
}
