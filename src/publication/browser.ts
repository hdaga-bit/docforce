import { chromium, type Browser, type BrowserContext } from "playwright";

export const CHROMIUM_INSTALL_HINT =
  "DocForce publication requires Playwright Chromium. Install with: npx playwright install chromium";

let shared: Browser | undefined;

export async function diagnosePublicationRenderer(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const browser = await launchChromium();
    await browser.close();
    shared = undefined;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatRendererError(err) };
  }
}

export async function getSharedBrowser(): Promise<Browser> {
  if (shared?.isConnected()) return shared;
  shared = await launchChromium();
  return shared;
}

export async function newPublicationContext(): Promise<BrowserContext> {
  const browser = await getSharedBrowser();
  return browser.newContext({
    viewport: { width: 1200, height: 1600 },
    deviceScaleFactor: 2,
  });
}

export async function closeSharedBrowser(): Promise<void> {
  if (!shared) return;
  try { await shared.close(); } catch { /* ignore */ }
  shared = undefined;
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage"],
    });
  } catch (err) {
    throw new Error(formatRendererError(err));
  }
}

function formatRendererError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/executable|browser|chromium|playwright/i.test(message)) {
    return `${CHROMIUM_INSTALL_HINT}\nUnderlying error: ${message}`;
  }
  return message;
}
