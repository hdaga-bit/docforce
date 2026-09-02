import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { PublicationBlock, PublicationDocument, PublicationSection } from "../types.js";
import type { PublicationTheme } from "../theme.js";

export async function renderDocx(
  document: PublicationDocument,
  theme: PublicationTheme,
  outputPath: string,
): Promise<void> {
  const children = [
    ...coverParagraphs(document, theme),
    pageBreak(),
    heading("Document Information", HeadingLevel.HEADING_1, theme),
    infoTable(document, theme),
    pageBreak(),
    heading("Contents", HeadingLevel.HEADING_1, theme),
    new TableOfContents("Contents", {
      hyperlink: true,
      headingStyleRange: "1-2",
      cachedEntries: document.sections.map((section) => ({
        title: section.title,
        level: section.level,
      })),
    }),
    pageBreak(),
    ...document.sections.flatMap((section) => renderSection(section, theme)),
  ];

  const headerText = theme.headerText || document.metadata.documentTitle;
  const footerText = theme.footerText || document.cover.organizationName || document.metadata.productName;

  const doc = new Document({
    creator: "DocForce",
    title: `${document.metadata.productName} — ${document.metadata.documentTitle}`,
    description: document.cover.evidenceStatement,
    styles: {
      default: {
        document: {
          run: { font: theme.bodyFont, size: 22 },
        },
      },
    },
    numbering: {
      config: [{
        reference: "pub-bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "•",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 420, hanging: 240 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: theme.pageSize === "Letter" ? 12240 : 11906,
            height: theme.pageSize === "Letter" ? 15840 : 16838,
          },
          margin: {
            top: mmToTwip(theme.marginMm),
            bottom: mmToTwip(theme.marginMm),
            left: mmToTwip(theme.marginMm),
            right: mmToTwip(theme.marginMm),
          },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: headerText, italics: true, size: 16, color: "4A5568", font: theme.bodyFont })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: footerText ? `${footerText}  ·  ` : "", size: 16, color: "4A5568", font: theme.bodyFont }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "4A5568" }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
}

function coverParagraphs(document: PublicationDocument, theme: PublicationTheme): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({ spacing: { after: 400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 200 },
      children: [new TextRun({
        text: document.cover.organizationName || " ",
        bold: true,
        color: theme.primaryColor.replace("#", ""),
        size: 28,
        font: theme.headingFont,
      })],
    }),
  ];
  if (document.cover.logoPath) {
    try {
      const data = readFileSync(document.cover.logoPath);
      const size = pngSize(data);
      const width = Math.min(180, size.width);
      const height = Math.round(size.height * (width / Math.max(size.width, 1)));
      out.push(new Paragraph({
        spacing: { after: 300 },
        children: [new ImageRun({ type: "png", data, transformation: { width, height } })],
      }));
    } catch {
      // Logo is optional once the path has already been validated.
    }
  }
  out.push(
    new Paragraph({
      spacing: { before: 400, after: 120 },
      children: [new TextRun({
        text: document.cover.productName,
        bold: true,
        size: 56,
        color: theme.headingColor.replace("#", ""),
        font: theme.headingFont,
      })],
    }),
    new Paragraph({
      spacing: { after: 400 },
      border: { bottom: { color: theme.accentColor.replace("#", ""), space: 1, style: BorderStyle.SINGLE, size: 12 } },
      children: [new TextRun({
        text: document.cover.documentTitle,
        size: 32,
        color: theme.accentColor.replace("#", ""),
        font: theme.headingFont,
      })],
    }),
  );
  if (document.cover.classification) {
    out.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: `Classification: ${document.cover.classification}`, size: 22, font: theme.bodyFont })],
    }));
  }
  if (document.cover.status) {
    out.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: `Status: ${document.cover.status}`, size: 22, font: theme.bodyFont })],
    }));
  }
  out.push(new Paragraph({
    spacing: { before: 400 },
    children: [new TextRun({
      text: document.cover.evidenceStatement,
      italics: true,
      size: 22,
      color: "4A5568",
      font: theme.bodyFont,
    })],
  }));
  return out;
}

function infoTable(document: PublicationDocument, theme: PublicationTheme): Table {
  return styledTable(
    ["Field", "Value"],
    document.information.map((row) => [row.label, row.value]),
    theme,
  );
}

function renderSection(section: PublicationSection, theme: PublicationTheme): Array<Paragraph | Table> {
  const level = section.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
  const nodes: Array<Paragraph | Table> = [heading(section.title, level, theme)];
  for (const block of section.blocks) {
    nodes.push(...renderBlock(block, theme));
  }
  return nodes;
}

function renderBlock(block: PublicationBlock, theme: PublicationTheme): Array<Paragraph | Table> {
  switch (block.kind) {
    case "paragraph":
      return [new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: block.text, font: theme.bodyFont, size: 22 })],
      })];
    case "bullet-list":
      return block.items.map((item) => new Paragraph({
        numbering: { reference: "pub-bullets", level: 0 },
        spacing: { after: 80 },
        children: [new TextRun({ text: item, font: theme.bodyFont, size: 22 })],
      }));
    case "table":
      return [styledTable(block.headers, block.rows, theme), new Paragraph({ text: "" })];
    case "figure":
      return figureParagraphs(block, theme);
    case "callout":
      return [calloutParagraph(block.title, block.text, fillForTone(block.tone, theme), theme)];
    case "page-break":
      return [pageBreak()];
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

function figureParagraphs(
  block: Extract<PublicationBlock, { kind: "figure" }>,
  theme: PublicationTheme,
): Paragraph[] {
  if (!block.pngPath) {
    throw new Error(`DOCX figure ${block.figureKind} is missing a PNG asset`);
  }
  const data = readFileSync(block.pngPath);
  const size = pngSize(data);
  const width = Math.min(620, size.width);
  const height = Math.round(size.height * (width / Math.max(size.width, 1)));
  return [
    new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [new ImageRun({ type: "png", data, transformation: { width, height } })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({
        text: block.caption,
        italics: true,
        size: 18,
        color: theme.figureCaptionColor.replace("#", ""),
        font: theme.bodyFont,
      })],
    }),
  ];
}

function styledTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  theme: PublicationTheme,
): Table {
  const fill = theme.tableHeaderFill.replace("#", "");
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => cell(h, theme, true, fill)),
  });
  const body = rows.map((row) => new TableRow({
    children: row.map((value) => cell(value, theme, false)),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...body],
  });
}

function cell(text: string, theme: PublicationTheme, header: boolean, fill?: string): TableCell {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    verticalAlign: VerticalAlign.CENTER,
    shading: header && fill ? { type: ShadingType.CLEAR, fill } : undefined,
    children: [new Paragraph({
      children: [new TextRun({
        text,
        bold: header,
        color: header ? theme.tableHeaderColor.replace("#", "") : "1A202C",
        size: header ? 20 : 20,
        font: theme.bodyFont,
      })],
    })],
  });
}

function calloutParagraph(title: string, text: string, fill: string, theme: PublicationTheme): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: fill.replace("#", "") },
    spacing: { before: 160, after: 160 },
    border: { left: { color: theme.accentColor.replace("#", ""), space: 8, style: BorderStyle.SINGLE, size: 24 } },
    children: [new TextRun({ text: `${title}. `, bold: true, font: theme.bodyFont, size: 22 }), new TextRun({ text, font: theme.bodyFont, size: 22 })],
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel], theme: PublicationTheme): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({
      text,
      bold: true,
      color: theme.headingColor.replace("#", ""),
      font: theme.headingFont,
      size: level === HeadingLevel.HEADING_1 ? 32 : 26,
    })],
  });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [], pageBreakBefore: true });
}

function fillForTone(tone: "coverage" | "unknown" | "limitation", theme: PublicationTheme): string {
  switch (tone) {
    case "coverage": return theme.calloutCoverageFill;
    case "unknown": return theme.calloutUnknownFill;
    case "limitation": return theme.calloutLimitationFill;
    default: {
      const exhaustive: never = tone;
      return exhaustive;
    }
  }
}

function mmToTwip(mm: number): number {
  return Math.round(mm * 56.7);
}

function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") {
    return { width: 600, height: 360 };
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
