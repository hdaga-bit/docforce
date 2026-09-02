export type PublicationPageSize = "A4" | "Letter";

export interface PublicationTheme {
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly headingColor: string;
  readonly bodyFont: string;
  readonly headingFont: string;
  readonly pageSize: PublicationPageSize;
  readonly marginMm: number;
  readonly headerText: string;
  readonly footerText: string;
  readonly tableHeaderFill: string;
  readonly tableHeaderColor: string;
  readonly calloutCoverageFill: string;
  readonly calloutUnknownFill: string;
  readonly calloutLimitationFill: string;
  readonly figureCaptionColor: string;
}

/**
 * Neutral professional defaults. Not Mary- or PAT-specific.
 * Fonts are generic families that resolve to standard system faces.
 */
export const DEFAULT_PUBLICATION_THEME: PublicationTheme = {
  primaryColor: "#1B365D",
  accentColor: "#2B6CB0",
  headingColor: "#1B365D",
  bodyFont: "Calibri",
  headingFont: "Calibri",
  pageSize: "A4",
  marginMm: 18,
  headerText: "",
  footerText: "",
  tableHeaderFill: "#1B365D",
  tableHeaderColor: "#FFFFFF",
  calloutCoverageFill: "#E8F1F8",
  calloutUnknownFill: "#F7F1E3",
  calloutLimitationFill: "#F3E8E8",
  figureCaptionColor: "#4A5568",
};

const HEX = /^#([0-9A-Fa-f]{6})$/;

export function parseHexColor(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  if (!value) return fallback;
  return HEX.test(value) ? value : fallback;
}

export function parsePageSize(raw: string | undefined): PublicationPageSize {
  return raw?.trim().toLowerCase() === "letter" ? "Letter" : "A4";
}

export function parseMarginMm(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10 || n > 40) return DEFAULT_PUBLICATION_THEME.marginMm;
  return n;
}

export function cssFontStack(preferred: string): string {
  const safe = preferred.trim() || "Calibri";
  return `"${safe}", "Segoe UI", Arial, Helvetica, sans-serif`;
}
