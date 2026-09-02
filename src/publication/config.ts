import {
  DEFAULT_PUBLICATION_THEME,
  parseHexColor,
  type PublicationTheme,
} from "./theme.js";

export const DEFAULT_DOCUMENT_TITLE = "Technical Architecture & Design Document";
export const DEFAULT_EVIDENCE_STATEMENT = "Generated from validated repository evidence.";
export const DEFAULT_COVERAGE_NOTE = "Scanner coverage is not a completeness claim.";
export const DEFAULT_PUBLISHED_DIR = "docs/published";
export const PUBLICATION_STAGING_DIR = ".docforce/publication";

export interface PublicationOrganizationConfig {
  readonly name: string;
  readonly logo?: string;
}

export interface PublicationDocumentConfig {
  readonly title: string;
  readonly classification: string;
  readonly status: string;
}

export interface PublicationFooterConfig {
  readonly text: string;
}

export interface DocforcePublicationConfig {
  readonly organization: PublicationOrganizationConfig;
  readonly document: PublicationDocumentConfig;
  readonly theme: PublicationTheme;
  readonly footer: PublicationFooterConfig;
  readonly includeOperationalProvenance: boolean;
  readonly outputDir: string;
}

export const DEFAULT_PUBLICATION_CONFIG: DocforcePublicationConfig = {
  organization: { name: "" },
  document: {
    title: DEFAULT_DOCUMENT_TITLE,
    classification: "",
    status: "",
  },
  theme: DEFAULT_PUBLICATION_THEME,
  footer: { text: "" },
  includeOperationalProvenance: false,
  outputDir: DEFAULT_PUBLISHED_DIR,
};

export function resolvePublicationConfig(
  configured: DocforcePublicationConfig | undefined,
): DocforcePublicationConfig {
  if (!configured) return DEFAULT_PUBLICATION_CONFIG;
  const footerText = configured.footer.text || configured.theme.footerText;
  return {
    ...configured,
    theme: { ...configured.theme, footerText },
    footer: { text: footerText },
  };
}

export function mergePublicationTheme(
  overrides: Partial<PublicationTheme> | undefined,
): PublicationTheme {
  const base = DEFAULT_PUBLICATION_THEME;
  const defined = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<PublicationTheme>;
  return {
    ...base,
    ...defined,
    primaryColor: parseHexColor(defined.primaryColor, base.primaryColor),
    accentColor: parseHexColor(defined.accentColor, base.accentColor),
    headingColor: parseHexColor(defined.headingColor, defined.primaryColor ?? base.headingColor),
    tableHeaderFill: parseHexColor(defined.tableHeaderFill, defined.primaryColor ?? base.tableHeaderFill),
    pageSize: defined.pageSize ?? base.pageSize,
    marginMm: defined.marginMm ?? base.marginMm,
  };
}

export function publicationFileStem(productName: string): string {
  const slug = productName.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "Product";
  return `${slug}-Technical-Architecture`;
}
