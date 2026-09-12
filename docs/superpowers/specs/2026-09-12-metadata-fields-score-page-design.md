# Metadata as fields, and a page per score — design

Supersedes the metadata parts of `2026-09-12-score-versions-metadata-design.md`.
Versions stay exactly as built. What changes: metadata is a set of fields with an
*enforce* flag instead of a free JSON object, it is folded into the download as
`x-` prefixed root keys instead of under `author_metadata`, and each score gets
its own page for versions and metadata instead of expanding inside the listing.

## Decisions taken with the user

| question | answer |
|---|---|
| existing hub contents | cleared on this machine before the change lands |
| editor | key / value rows with an *enforce* checkbox, not a JSON textarea |
| where metadata lands on download | root keys, each prefixed `x-` |
| value type | string, unless the text is a JSON number, `true`, `false` or `null` |
| how enforcement is shown | one root key `x-enforced` listing the enforced keys by full name |
| where versions and metadata are handled | a separate page per score, reached by clicking the score |

## Clearing the hub

Before the new code is committed, everything under `hub/files/` on this machine
is deleted, including every hidden `.versions/` folder. The stored metadata
shape below is not compatible with the old one, and nothing on the hub today
needs keeping. No other machine hosts a hub.

## Stored shape (`N.meta.json`)

```json
{
  "author": { "value": "renjith", "enforced": true },
  "bpm":    { "value": 128,       "enforced": false }
}
```

A map from field name to `{ value, enforced }`.

- `value` is a JSON scalar: string, number, boolean or null. Objects and arrays
  are refused.
- `enforced` is a boolean; when absent it is `false`.
- Field names are stored as typed: non-empty, no leading or trailing whitespace.
  The `x-` prefix is added only on download.

`PUT …?meta[&v=N]` with anything else is `400` with the reason: body not a JSON
object · entry `<key>` is not an object · `<key>`: value must be a string,
number, boolean or null · `<key>`: enforced must be true or false · empty field
name. Nothing is written when the body is refused.

`GET …?meta[&v=N]` returns the stored map, `{}` when none.

## The merge, on download

When a version has metadata and its bytes parse as a JSON object:

1. For each field in stored order, set root key `x-<name>` to `value`,
   replacing any existing key of that name.
2. If at least one field is enforced, set root key `x-enforced` to the list of
   enforced keys by full name, in field order, e.g. `["x-author"]`. If none is
   enforced, no `x-enforced` key is added.
3. Serialise with `indent=1`, `ensure_ascii=False`.

`author_metadata` is no longer produced anywhere. Unchanged from before:
`?raw` skips the merge; a version with no metadata downloads byte-identical;
bytes that are not a JSON object download unchanged and `?versions` reports
`mergeable: false` for them.

Example. Uploaded `{"score":"levels","grid":{"bpm":128}}`, metadata as above,
downloaded:

```json
{
 "score": "levels",
 "grid": { "bpm": 128 },
 "x-author": "renjith",
 "x-bpm": 128,
 "x-enforced": ["x-author"]
}
```

## `?versions` gains field counts

Each entry adds `"fields": 2, "enforced": 1` so the score page can show them
without fetching every version's metadata. `has_metadata` stays.

## The score page

`GET /hub/<dir>/<name>.score?page` serves `hub/score.html` for any `.score`
name, even one with no versions yet (the page then says so). For a non-`.score`
name `?page` is `400 not a versioned file`, like the other version queries.

The folder page (`hub/hub.html`) changes in one place: a `.score` row's name
links to `?page`; a `download` link for the latest sits beside the `vN` badge.
The inline `versions` button, expanded rows and editor are removed.

The score page shows:

- breadcrumb `HUB / <dir> / <name>`, built from the URL
- the name, a `vN` badge for the latest, `download latest` (plain `GET`), and
  `upload new version`: a file picker that `PUT`s the chosen file to this same
  URL, then reloads the list. The picked file's own name is ignored; it becomes
  the next version of this score.
- the versions, newest first: `vN` (with `latest` on the top one), date, size,
  `2 fields · 1 enforced` or `no metadata`, a `download` link (`?v=N`) and a
  `metadata` button.
- the editor, under the version whose button was clicked, one open at a time:
  one row per field with a key input, a value input, an `enforce` checkbox and a
  `remove` button; below them `add field`, `save`, `cancel`, and a message area.
  Existing fields are prefilled: strings as typed, other scalars as their JSON
  text.
- a version with `mergeable: false` shows, beside the editor, that the file is
  not a JSON object so fields are stored but not folded into downloads.

On save the page:

1. drops rows whose key and value are both empty
2. refuses, in place and without sending, an empty key with a value, a key
   with leading or trailing spaces, or a duplicate key
3. converts each value: text that parses as a JSON number, `true`, `false` or
   `null` becomes that scalar; everything else is the string as typed
4. `PUT`s the map to `?meta&v=N`; a server refusal is shown in place with the
   server's reason

Every request the page makes is one `curl` could make; nothing is page-only.
No external library; the page must work on a LAN with no internet.

## Unchanged

The CLI (`push`, `pull`, `pull name@N`) does not change: the server does the
merge. `cli/remote.js` does not change. Storage of versions does not change.

## Tests (`node cli/remote.test.js`)

The metadata block is rewritten:

1. `PUT ?meta&v=1` with the two-field map → 204; `GET ?meta&v=1` returns it unchanged
2. `GET ?v=1` parses; has `x-author` = "renjith", `x-bpm` = 128 (a number), `x-enforced` = `["x-author"]`, keeps `grid.bpm`, and has no `author_metadata`
3. a map with nothing enforced → download has the `x-` keys and no `x-enforced`
4. `?raw&v=1` is byte-identical to the upload; a version without metadata downloads byte-identical
5. refusals, each 400 with the stated reason and nothing written: `[1,2]` · `{"a": 1}` (entry not an object) · `{"a": {"value": {"nested": 1}}}` · `{"a": {"value": 1, "enforced": "yes"}}` · `{"": {"value": 1}}`
6. `?versions` reports `fields` and `enforced` counts; the listing row's `has_metadata` is true
7. a `.score` that is not JSON downloads unchanged with metadata; `mergeable: false`
8. `GET name.score?page` is `text/html`; `GET notes.txt?page` is 400
9. a `.score` uploaded before versioning existed still answers `?page`

The CLI block's merged-latest check reads `x-who` instead of `author_metadata.who`.

The score page is driven once in headless Chrome after the API passes: open it
from the folder page by clicking the name, add two fields with one enforced,
save, see `2 fields · 1 enforced`, download that version and check the three
keys, then upload a new version from the page and see `v3`.

## Out of scope

Editing a score's own fields, validating field names against a schema,
metadata on non-`.score` files, migrating old `author_metadata` files (the hub
is cleared instead), and anything in the CLI.
