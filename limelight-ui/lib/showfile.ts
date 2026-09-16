import type { V2Plan } from "./planConvert";

/* ── the show file, as a document ─────────────────────────────────────────────
   A saved show already leaves the browser twice: once as the song's show file
   (POST /api/showfile) and once as the record Shows lists. The file is the
   portable one — it is what "Import show file" reads back in — but until now the
   only copy lived on the hub, so taking a show to another machine, mailing it to
   a venue, or keeping a version outside the hub meant reaching into
   portal/showfiles by hand.

   This module builds that same document on the client, so Download and Save
   write the same bytes from the same plan. The envelope is the server's, from
   portal/server.py:

       doc = {"schema": "limelight.show/1", "song": song, **plan}

   and editsToPlan() returns {plan: text, states, bindings, gestures} — so the
   spread lands those four keys after `schema` and `song`, which is exactly the
   key order in portal/showfiles/*.show.json. Nothing here re-derives the show:
   it wraps what handleSave would have sent. */

export const SHOW_SCHEMA = "limelight.show/1";

export interface ShowFileDoc extends V2Plan {
  schema: string;
  song: string;
}

/** The document the hub would have written for this song and plan. */
export function buildShowFile(song: string, plan: V2Plan): ShowFileDoc {
  return { schema: SHOW_SCHEMA, song: baseName(song), ...plan };
}

/* The server runs every incoming song name through os.path.basename before it
   touches the filesystem, so a name carrying a path writes to showfiles/ all the
   same. A download names a file the browser will accept, and the two should not
   disagree about which song this is. */
function baseName(song: string): string {
  const cut = song.replace(/\\/g, "/");
  return cut.slice(cut.lastIndexOf("/") + 1);
}

/** What the hub calls this song's file, so a download is drop-in replaceable. */
export function showFileName(song: string): string {
  return `${baseName(song) || "show"}.show.json`;
}

/* indent=1 and a trailing newline, because that is what json.dump writes on the
   hub — a file downloaded, edited by hand and saved back should show a diff of
   the edit and nothing else. */
export function serializeShowFile(doc: ShowFileDoc): string {
  return JSON.stringify(doc, null, 1) + "\n";
}
