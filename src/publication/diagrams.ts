import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { newPublicationContext } from "./browser.js";
import type { PublicationDocument, PublicationFigure } from "./types.js";

const require = createRequire(import.meta.url);

export interface RenderedDiagrams {
  readonly count: number;
  readonly document: PublicationDocument;
}

/**
 * Render Mermaid figures through a shared Playwright Chromium page.
 * PDF uses SVG; DOCX uses high-resolution PNG. Sources are never overwritten.
 */
export async function renderPublicationDiagrams(
  document: PublicationDocument,
  assetDir: string,
): Promise<RenderedDiagrams> {
  const figures = document.sections.flatMap((s) => s.blocks.filter((b): b is PublicationFigure => b.kind === "figure"));
  if (figures.length === 0) {
    return { count: 0, document };
  }

  mkdirSync(assetDir, { recursive: true });
  const context = await newPublicationContext();
  try {
    const page = await context.newPage();
    await page.setContent(mermaidHostHtml(), { waitUntil: "load" });
    const ready = await page.evaluate(() => typeof (window as unknown as { mermaid?: unknown }).mermaid !== "undefined");
    if (!ready) {
      throw new Error("Mermaid runtime failed to load in the publication renderer");
    }

    const rendered = new Map<string, { pngPath: string; svgPath: string }>();
    for (const figure of figures) {
      const svg = await page.evaluate(async (source: string) => {
        const mermaid = (window as unknown as {
          mermaid: { render: (id: string, src: string) => Promise<{ svg: string }> };
        }).mermaid;
        const id = `fig-${Math.random().toString(36).slice(2, 10)}`;
        const result = await mermaid.render(id, source);
        return result.svg;
      }, figure.mermaidSource);
      if (!svg.includes("<svg")) {
        throw new Error(`Mermaid renderer produced no SVG for ${figure.figureKind}`);
      }

      const svgPath = join(assetDir, `${figure.figureKind}.svg`);
      const pngPath = join(assetDir, `${figure.figureKind}.png`);
      writeFileSync(svgPath, svg, "utf-8");

      await page.setContent(
        `<!doctype html><html><head><style>html,body{margin:0;padding:16px;background:#fff;}svg{max-width:1100px;height:auto;display:block;}</style></head><body>${svg}</body></html>`,
        { waitUntil: "load" },
      );
      const box = page.locator("svg").first();
      await box.screenshot({ path: pngPath, type: "png" });
      rendered.set(figure.figureKind, { pngPath, svgPath });
      await page.setContent(mermaidHostHtml(), { waitUntil: "load" });
    }

    const next: PublicationDocument = {
      ...document,
      sections: document.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => {
          if (block.kind !== "figure") return block;
          const assets = rendered.get(block.figureKind);
          if (!assets) {
            throw new Error(`Diagram ${block.figureKind} was referenced but not rendered`);
          }
          return { ...block, pngPath: assets.pngPath, svgPath: assets.svgPath };
        }),
      })),
    };
    return { count: figures.length, document: next };
  } finally {
    await context.close();
  }
}

function mermaidHostHtml(): string {
  const mermaidJs = readFileSync(require.resolve("mermaid/dist/mermaid.min.js"), "utf-8");
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
<script>${mermaidJs}</script>
<script>
  window.mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "strict",
    fontFamily: "Segoe UI, Arial, sans-serif"
  });
</script>
</body></html>`;
}
