/**
 * Screenshots for bug reports (T-072): the app's own view only — never other
 * tabs or the desktop. Password fields and anything marked `data-private` are
 * left out of the render, and the image is capped in size and bytes.
 */
export const MAX_SCREENSHOT_BYTES = 1_000_000;
const MAX_WIDTH = 1600;

/** Whether a node may appear in a screenshot: never a password field or a `data-private` element. */
export function capturable(node: { tagName?: string; getAttribute?: (name: string) => string | null; hasAttribute?: (name: string) => boolean }): boolean {
  if (node.hasAttribute?.('data-private')) return false;
  if (node.hasAttribute?.('data-bug-report-ui')) return false; // the report button and dialog themselves
  if (node.tagName?.toUpperCase() === 'INPUT' && node.getAttribute?.('type')?.toLowerCase() === 'password') return false;
  return true;
}

/** A masked JPEG of the app root as base64, or null when it cannot be made small enough. */
export async function captureAppView(root: HTMLElement): Promise<{ contentType: 'image/jpeg'; data: string } | null> {
  try {
    const { toJpeg } = await import('html-to-image');
    const width = Math.min(root.scrollWidth, MAX_WIDTH);
    for (const quality of [0.75, 0.55, 0.35]) {
      const url = await toJpeg(root, {
        quality,
        pixelRatio: 1,
        canvasWidth: width,
        canvasHeight: Math.round((root.scrollHeight * width) / Math.max(root.scrollWidth, 1)),
        backgroundColor: '#ffffff',
        skipFonts: true,
        cacheBust: false,
        filter: (node) => capturable(node as HTMLElement),
      });
      const data = url.slice(url.indexOf(',') + 1);
      if ((data.length * 3) / 4 <= MAX_SCREENSHOT_BYTES) return { contentType: 'image/jpeg', data };
    }
    return null;
  } catch {
    return null;
  }
}

/** Context attached without the user typing it. The server scrubs it again before storing. */
export function pageContext(): { route: string; userAgent: string; viewport: string; occurredAt: string } {
  return {
    route: `${window.location.pathname}${window.location.search}`,
    userAgent: navigator.userAgent.slice(0, 500),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    occurredAt: new Date().toISOString(),
  };
}
