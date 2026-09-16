/* Handing the browser a file.

   Kept apart from showfile.ts so that module stays pure and testable under
   `node --test`: everything here touches the DOM and nothing here knows what a
   show is. */

/** Save `text` to the user's downloads as `filename`. */
export function downloadText(
  filename: string,
  text: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  /* Firefox will not follow a click on an anchor that was never in the
     document, so it goes in and comes straight back out. */
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoking in the same tick cancels the download in Safari; a frame is enough
     for the navigation to have taken the blob. */
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
