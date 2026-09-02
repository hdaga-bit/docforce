import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { newPublicationContext } from "../browser.js";
import type { PublicationTheme } from "../theme.js";
import type { PublicationDocument } from "../types.js";
import { renderPublicationHtml } from "./html.js";

export async function renderPdf(
  document: PublicationDocument,
  theme: PublicationTheme,
  outputPath: string,
): Promise<{ pageCount: number }> {
  const html = renderPublicationHtml(document, theme);
  const context = await newPublicationContext();
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const headerText = theme.headerText || document.metadata.documentTitle;
    const footerText = theme.footerText || document.cover.organizationName || document.metadata.productName;
    const pdf = await page.pdf({
      format: theme.pageSize === "Letter" ? "Letter" : "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8pt;color:#4A5568;width:100%;padding:0 18mm;text-align:right;">${escape(headerText)}</div>`,
      footerTemplate: `<div style="font-size:8pt;color:#4A5568;width:100%;padding:0 18mm;text-align:right;">${escape(footerText)} <span class="pageNumber"></span></div>`,
      margin: {
        top: `${theme.marginMm + 8}mm`,
        bottom: `${theme.marginMm + 8}mm`,
        left: `${theme.marginMm}mm`,
        right: `${theme.marginMm}mm`,
      },
      outline: true,
      tagged: true,
    });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, pdf);
    return { pageCount: countPdfPages(pdf) };
  } finally {
    await context.close();
  }
}

export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?!s)\b/g);
  return matches?.length ?? 0;
}

export function pdfContainsText(pdf: Buffer, needle: string): boolean {
  if (pdf.includes(Buffer.from(needle, "utf8"))) return true;
  return pdf.includes(Buffer.from(needle, "utf16le"));
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
