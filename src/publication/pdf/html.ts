import { readFileSync } from "node:fs";
import { cssFontStack, type PublicationTheme } from "../theme.js";
import type { PublicationBlock, PublicationDocument, PublicationSection } from "../types.js";

export function renderPublicationHtml(
  document: PublicationDocument,
  theme: PublicationTheme,
): string {
  const body = [
    renderCover(document, theme),
    `<section class="page info"><h1>Document Information</h1>${infoTable(document)}</section>`,
    `<section class="page toc"><h1>Contents</h1><ol>${document.sections.map((s) =>
      `<li class="${s.appendix ? "appendix" : ""}"><a href="#${s.id}">${escapeHtml(s.title)}</a></li>`,
    ).join("")}</ol></section>`,
    ...document.sections.map((section) => renderSection(section, theme)),
  ].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(document.metadata.productName)} — ${escapeHtml(document.metadata.documentTitle)}</title>
<style>${printCss(theme)}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function renderCover(document: PublicationDocument, theme: PublicationTheme): string {
  const logo = document.cover.logoPath && isPng(document.cover.logoPath)
    ? `<img class="logo" src="${dataUri(document.cover.logoPath)}" alt="">`
    : "";
  const classification = document.cover.classification
    ? `<p class="meta">Classification: ${escapeHtml(document.cover.classification)}</p>` : "";
  const status = document.cover.status
    ? `<p class="meta">Status: ${escapeHtml(document.cover.status)}</p>` : "";
  return `<section class="page cover">
    <p class="org">${escapeHtml(document.cover.organizationName)}</p>
    ${logo}
    <h1 class="product">${escapeHtml(document.cover.productName)}</h1>
    <p class="title">${escapeHtml(document.cover.documentTitle)}</p>
    ${classification}${status}
    <p class="evidence">${escapeHtml(document.cover.evidenceStatement)}</p>
  </section>`;
}

function infoTable(document: PublicationDocument): string {
  const rows = document.information.map((row) =>
    `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value)}</td></tr>`,
  ).join("");
  return `<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSection(section: PublicationSection, theme: PublicationTheme): string {
  const blocks = section.blocks.map((block) => renderBlock(block, theme)).join("\n");
  return `<section class="content ${section.appendix ? "appendix" : ""}" id="${section.id}">
    <h1>${escapeHtml(section.title)}</h1>
    ${blocks}
  </section>`;
}

function renderBlock(block: PublicationBlock, theme: PublicationTheme): string {
  switch (block.kind) {
    case "paragraph":
      return `<p>${escapeHtml(block.text)}</p>`;
    case "bullet-list":
      return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    case "table":
      return `<table><thead><tr>${block.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${block.rows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    case "figure": {
      const src = block.svgPath ?? block.pngPath;
      if (!src) throw new Error(`PDF figure ${block.figureKind} is missing an image asset`);
      const href = src.toLowerCase().endsWith(".svg")
        ? `data:image/svg+xml;base64,${readFileSync(src).toString("base64")}`
        : dataUri(src);
      return `<figure><img src="${href}" alt="${escapeHtml(block.caption)}"><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`;
    }
    case "callout":
      return `<aside class="callout ${block.tone}"><strong>${escapeHtml(block.title)}</strong><p>${escapeHtml(block.text)}</p></aside>`;
    case "page-break":
      return `<div class="break"></div>`;
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

function printCss(theme: PublicationTheme): string {
  const body = cssFontStack(theme.bodyFont);
  const heading = cssFontStack(theme.headingFont);
  const page = theme.pageSize === "Letter" ? "letter" : "A4";
  return `
    @page { size: ${page}; margin: ${theme.marginMm}mm; }
    @page { @bottom-right { content: counter(page); font-family: ${body}; font-size: 9pt; color: #4A5568; } }
    @page { @top-right { content: "${escapeCss(theme.headerText)}"; font-family: ${body}; font-size: 9pt; color: #4A5568; } }
    html, body { margin: 0; padding: 0; font-family: ${body}; color: #1A202C; font-size: 11pt; line-height: 1.45; }
    h1, h2 { font-family: ${heading}; color: ${theme.headingColor}; page-break-after: avoid; }
    h1 { font-size: 16pt; margin: 1.2em 0 0.5em; }
    p { margin: 0 0 0.7em; }
    ul { margin: 0 0 0.8em 1.2em; }
    li { margin: 0 0 0.25em; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 1em; font-size: 10pt; }
    thead { display: table-header-group; }
    th { background: ${theme.tableHeaderFill}; color: ${theme.tableHeaderColor}; text-align: left; padding: 6px 8px; }
    td { padding: 6px 8px; border-bottom: 1px solid #E2E8F0; vertical-align: top; word-wrap: break-word; }
    figure { margin: 1em 0; page-break-inside: avoid; }
    figure img { max-width: 100%; height: auto; }
    figcaption { font-size: 9.5pt; color: ${theme.figureCaptionColor}; font-style: italic; margin-top: 0.4em; }
    .cover { page-break-after: always; padding-top: 28mm; }
    .cover .org { color: ${theme.primaryColor}; font-weight: 700; letter-spacing: 0.04em; }
    .cover .product { font-size: 28pt; margin: 18mm 0 6mm; color: ${theme.headingColor}; }
    .cover .title { font-size: 16pt; color: ${theme.accentColor}; border-bottom: 3px solid ${theme.accentColor}; padding-bottom: 8px; }
    .cover .evidence { margin-top: 18mm; font-style: italic; color: #4A5568; }
    .logo { max-height: 48px; margin: 8px 0 16px; }
    .page { page-break-after: always; }
    .content h1 { page-break-before: auto; }
    .callout { padding: 10px 12px; margin: 0 0 1em; border-left: 4px solid ${theme.accentColor}; page-break-inside: avoid; }
    .callout.coverage { background: ${theme.calloutCoverageFill}; }
    .callout.unknown { background: ${theme.calloutUnknownFill}; }
    .callout.limitation { background: ${theme.calloutLimitationFill}; }
    .toc ol { padding-left: 1.2em; }
    .break { page-break-after: always; }
  `;
}

function dataUri(path: string): string {
  const buf = readFileSync(path);
  const mime = path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function isPng(path: string): boolean {
  return /\.(png|jpe?g)$/i.test(path);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCss(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\22 ");
}
