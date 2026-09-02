/**
 * Downstream publication artifacts. These are not System Model sources and
 * must not be mixed into ARTIFACT_REGISTRY / architecture discovery.
 */
export const PUBLICATION_FORMATS = ["docx", "pdf"] as const;
export type RegisteredPublicationFormat = (typeof PUBLICATION_FORMATS)[number];

export interface PublicationArtifactDefinition {
  readonly id: "technical-architecture.docx" | "technical-architecture.pdf";
  readonly format: RegisteredPublicationFormat;
  readonly title: string;
  readonly source: "publication-model";
}

export const PUBLICATION_REGISTRY: readonly PublicationArtifactDefinition[] = [
  {
    id: "technical-architecture.docx",
    format: "docx",
    title: "Technical Architecture (DOCX)",
    source: "publication-model",
  },
  {
    id: "technical-architecture.pdf",
    format: "pdf",
    title: "Technical Architecture (PDF)",
    source: "publication-model",
  },
];
