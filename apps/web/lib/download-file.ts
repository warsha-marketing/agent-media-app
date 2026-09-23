// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Save a file from the browser. Downloads only: nothing here encodes video.
 */

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Save a hosted file (a Short). A cross-origin <a download> is ignored by
 * browsers, so fetch the file and save it; if the storage origin does not
 * allow that, open it instead.
 */
export async function downloadUrl(url: string, name: string): Promise<void> {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    saveBlob(await r.blob(), name);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** Save text made in the page (e.g. an .srt) as a UTF-8 file. */
export function downloadText(text: string, name: string, mime: string): void {
  saveBlob(new Blob([text], { type: `${mime};charset=utf-8` }), name);
}
