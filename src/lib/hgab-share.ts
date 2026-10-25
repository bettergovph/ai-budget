/**
 * Download, share and copy helpers for the leaderboard share images.
 *
 * `shareImage` uses the Web Share API with files (Level 2) only where the
 * browser says it can share this exact payload; anywhere else it returns
 * 'unsupported' and the page offers the download instead. The link goes in
 * the share text, not the `url` field: several share targets (iOS Messages,
 * WhatsApp, Android Chrome) keep the link and drop the image when both are given.
 */

export type ShareResult = 'shared' | 'unsupported' | 'cancelled';

/** Save a blob as a file through a temporary object URL. Resolves once the download has been handed to the browser. */
export async function downloadBlob(blob: Blob, fileName: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late: Safari and Firefox read the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function shareImage(opts: { blob: Blob; fileName: string; title: string; text: string; url: string }): Promise<ShareResult> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return 'unsupported';
  let file: File;
  try {
    file = new File([opts.blob], opts.fileName, { type: opts.blob.type || 'image/png' });
  } catch {
    return 'unsupported';
  }
  const text = [opts.text, opts.url].filter(Boolean).join('\n');
  const payload: ShareData = { files: [file], title: opts.title, text };
  let ok: boolean;
  try {
    ok = navigator.canShare(payload);
  } catch {
    ok = false;
  }
  if (!ok) return 'unsupported';
  try {
    await navigator.share(payload);
    return 'shared';
  } catch (err) {
    const name = err instanceof DOMException ? err.name : (err as { name?: string } | null)?.name;
    if (name === 'AbortError') return 'cancelled';
    // NotAllowedError (the tap's activation expired), DataError, TypeError: fall back to the download.
    return 'unsupported';
  }
}

/** Copy text to the clipboard; falls back to a hidden textarea where the async API is missing or blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
