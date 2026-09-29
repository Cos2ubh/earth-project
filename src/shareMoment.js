// Share-a-moment: turns "look at this" into something that actually
// travels. Two halves:
//
//   1. URL state: the current simulated time + camera position get encoded
//      into query params (?t=...&cx=...&cy=...&cz=...). Opening that link
//      reproduces the exact view (same moment in history, same angle)
//      instead of dumping the visitor back at "now, default camera".
//
//   2. A composed share image: the rendered WebGL frame plus a small
//      burned-in stat card (echoing the HUD) so a downloaded PNG is
//      self-explanatory even divorced from the page: someone looking at
//      a tweet doesn't get to hover for a tooltip.
//
// Nothing here touches simulated time or astronomy math directly; it only
// reads/writes camera position and the URL.

const PARAM_TIME = 't';
const PARAM_CX = 'cx';
const PARAM_CY = 'cy';
const PARAM_CZ = 'cz';

/**
 * Parse ?t=&cx=&cy=&cz= from the current URL, if all four are present and
 * valid. Returns { date, position: {x,y,z} } or null (missing/malformed:
 * callers should fall back to the normal live/intro behavior, not error out
 * over a bad or partial link).
 */
export function readSharedStateFromUrl(href = window.location.href) {
    const params = new URL(href).searchParams;
    const t = params.get(PARAM_TIME);
    const cx = params.get(PARAM_CX);
    const cy = params.get(PARAM_CY);
    const cz = params.get(PARAM_CZ);
    if (t === null || cx === null || cy === null || cz === null) return null;

    const date = new Date(t);
    const position = { x: parseFloat(cx), y: parseFloat(cy), z: parseFloat(cz) };
    if (Number.isNaN(date.getTime())) return null;
    if ([position.x, position.y, position.z].some((v) => Number.isNaN(v))) return null;

    return { date, position };
}

/**
 * Build a shareable URL encoding the given date + camera position.
 * Strips any other query params so shared links stay clean and small.
 */
export function buildShareUrl(date, cameraPosition, href = window.location.href) {
    const url = new URL(href);
    url.search = '';
    url.searchParams.set(PARAM_TIME, date.toISOString());
    url.searchParams.set(PARAM_CX, cameraPosition.x.toFixed(3));
    url.searchParams.set(PARAM_CY, cameraPosition.y.toFixed(3));
    url.searchParams.set(PARAM_CZ, cameraPosition.z.toFixed(3));
    return url.toString();
}

/**
 * Build a Twitter/X "compose tweet" intent URL. Opening this in a new tab
 * pre-fills the tweet text + link; the person still has to actually hit
 * Tweet themselves (intents can't post on someone's behalf, by design).
 */
export function buildTweetIntentUrl(shareUrl, text) {
    const params = new URLSearchParams({ text, url: shareUrl });
    return `https://twitter.com/intent/tweet?${params.toString()}`;
}

/**
 * Copy text to the clipboard. Returns a Promise<boolean>: true on success.
 * Clipboard access can be denied (permissions, non-secure context) and
 * that's routine, not exceptional. Callers should treat false as "show the
 * link some other way," not as a crash.
 */
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * Compose a shareable PNG: the current rendered frame plus a small stat
 * card burned into the bottom-left corner, styled to echo the on-page HUD.
 * Forces one more composer render first so the captured frame is current.
 *
 * @param renderer THREE.WebGLRenderer: its .domElement is the source pixels.
 * @param composer EffectComposer: re-rendered once, synchronously, right
 *                 before capture so the buffer is guaranteed fresh.
 * @param lines    string[]: stat lines, e.g. ["2026-09-28 12:00 UTC",
 *                 "Axial tilt 23.4381°", "Moon 95.9% · 373,485 km"].
 * @returns data URL (image/png).
 */
export function captureMomentImage(renderer, composer, lines) {
    composer.render();

    const src = renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src, 0, 0);

    // Scale the overlay relative to the actual pixel size (src.width already
    // includes devicePixelRatio via the renderer), so it reads consistently
    // whether captured on a phone or a 4K desktop.
    const scale = src.width / 1600;
    const pad = 28 * scale;
    const lineHeight = 22 * scale;
    const fontSize = 14 * scale;
    const titleSize = 10 * scale;
    const cardWidth = 340 * scale;
    const cardHeight = pad * 2 + lineHeight * lines.length;
    const cardX = pad * 0.7;
    const cardY = canvas.height - cardHeight - pad * 0.7;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    // roundRect is broadly supported (Chrome/Firefox/Safari 2022+) but not
    // universal, so fall back to a plain rect rather than let capture throw.
    if (ctx.roundRect) {
        ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 10 * scale);
    } else {
        ctx.rect(cardX, cardY, cardWidth, cardHeight);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.font = `${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
        ctx.fillText(line, cardX + pad * 0.6, cardY + pad * 0.6 + i * lineHeight);
    });

    // Small watermark bottom-right so a re-shared image still credits the
    // source even once it's been screenshotted-of-a-screenshot a few times.
    ctx.font = `${titleSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'right';
    ctx.fillText('earth-project', canvas.width - pad * 0.7, canvas.height - pad * 0.7 - titleSize);

    return canvas.toDataURL('image/png');
}

/** Trigger a browser download of a data URL under the given filename. */
export function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}
