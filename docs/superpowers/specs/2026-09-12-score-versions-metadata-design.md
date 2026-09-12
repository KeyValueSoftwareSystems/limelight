# Score versions and author metadata — design

Every `.score` in the hub keeps every version it was ever uploaded as, and any
version can carry a JSON object of author metadata that is folded into the file
when it is downloaded. Other file types are untouched by this: they overwrite
silently as before.

Builds on `2026-09-12-score-push-pull-design.md` (the CLI) and the hub at
`hub/hub.py`. Nothing in the CLI's network code changes shape; the hub's URLs
do not change; versions and metadata are reached by query string on the same
file URL.

## Decisions taken with the user

| question | answer |
|---|---|
| scope | `.score` files only |
| same bytes uploaded again | always a new version |
| CLI | `pull name@N` fetches version N; plain `pull` is the latest |
| storage | hidden `.versions/` folder beside the file (option A below) |

## Storage

```
hub/files/score/levels.score                          the latest bytes, as uploaded (a copy)
hub/files/score/.versions/levels.score/1.score        version 1, bytes as uploaded
hub/files/score/.versions/levels.score/2.score        version 2
hub/files/score/.versions/levels.score/2.meta.json    author metadata for version 2 (absent until added)
```

- Version numbers are integers from 1, in upload order. The latest is the
  highest number present.
- The top-level file is always a copy of the latest version's raw bytes, so a
  plain `GET`, the folder listing, `HEAD`, `limelight pull` and any dufs client
  keep working with no knowledge of versions.
- `.versions/` never appears in a listing and cannot be addressed by URL: a
  path containing a `.versions` segment is refused with 403, so the raw store is
  reached only through the API below.
- Metadata is a JSON object, stored as written. Anything that is not an object
  is refused before it touches disk.

Alternatives considered: each `.score` as a directory of versions (breaks the
plain `GET` and the CLI's post-push size check), and one index file per folder
with blobs by hash (a write hotspot, and one bad write loses the history).

## API

All on the existing file URL `/hub/<dir>/<name>.score`. `v` is a version
number; when omitted it means the latest.

| request | does | reply |
|---|---|---|
| `PUT <file>` | store as version N+1, copy to top level | `201`, body `{"name":"levels.score","version":N+1}` |
| `GET <file>` | latest, merged | bytes |
| `GET <file>?v=2` | version 2, merged | bytes, or `404 no version 2` |
| `GET <file>?raw[&v=N]` | bytes exactly as uploaded, no merge | bytes |
| `HEAD <file>[?v=N][&raw]` | same as GET, headers only | `content-length` of what GET would send |
| `GET <file>?versions` | the history | `{"name","latest":3,"versions":[{"version","size","mtime","has_metadata","mergeable"}]}` |
| `GET <file>?meta[&v=N]` | the metadata object | the object, or `{}` when none |
| `PUT <file>?meta[&v=N]` | store metadata | `204`; `400` with the parse error when the body is not a JSON object; `404` when the version does not exist |

The folder listing (`GET <dir>/?json`) hides `.versions/` and adds two fields
to `.score` rows: `"version": 3` and `"has_metadata": true`. Other clients
ignore fields they do not know.

For a name that is not `.score`, `?v`, `?versions`, `?meta` and `?raw` are
answered `400 not a versioned file`, and `PUT` overwrites as today.

## The merge

When a version is downloaded without `?raw`:

1. If no `N.meta.json` exists for that version, send the uploaded bytes exactly.
   A push followed by a pull is byte-identical, which the existing test relies on.
2. Otherwise parse the version's bytes as JSON. If the result is an object, set
   its `author_metadata` key to the stored metadata, replacing any existing
   value, and send it serialised with `indent=1` and `ensure_ascii=False`, the
   formatting of `protocol/score.levels.json`.
3. If the bytes are not a JSON object, send them exactly and let `?versions`
   report `"mergeable": false` for that version, so the page can say why the
   metadata will not appear.

Only the download is affected. The stored bytes are never rewritten.

## The page

- A `.score` row shows its version as a badge (`v3`) and a `versions` toggle.
  The name link still downloads the latest, merged.
- Expanded, the row lists every version, newest first: number, size, date, a
  `download` link (`?v=N`) and a `metadata` button, labelled `add metadata` or
  `edit metadata` depending on `has_metadata`.
- The metadata button opens an inline editor under that version: a
  `<textarea>` prefilled with the current object pretty-printed, or `{}`, and
  `save` / `cancel`. Save parses locally first; a parse error or a non-object is
  shown beside the editor and nothing is sent. On success it `PUT`s `?meta&v=N`,
  closes the editor and refreshes the row. A server error is shown in place.
- A version marked `mergeable: false` shows a note beside the editor: the file is
  not a JSON object, so metadata will be stored but not folded into downloads.
- No external library. The page has to work on a LAN with no internet.

## The CLI

- `limelight pull levels.score@2` downloads version 2 into the current
  directory as `levels.score`. The `@N` suffix is recognised only when `N` is
  all digits, so a name containing `@` for other reasons still works.
- `limelight pull levels.score` is unchanged: the latest, merged.
- `limelight push` is unchanged in what it sends. Its message gains the version:
  `pushed levels.score → http://…/score/levels.score (477 bytes, v3)`. When the
  server's reply has no version, as from a dufs, the message is as today.
- `cli/remote.js`: `get(name, version)` appends `?v=N` when a version is given;
  `put` returns the parsed JSON body when there is one, else `null`. The post-push
  size check still compares `HEAD` of the latest to the local size, which holds
  because a fresh version has no metadata yet.
- `pull name@N` of a version that does not exist exits 1 with the versions the
  server has, the same shape as a missing name listing what is there.

## Errors — surfaced

- Version does not exist: `404 no version 7 of levels.score`.
- Metadata body not JSON: `400` with the parser's message and position.
- Metadata is JSON but not an object: `400 metadata must be a JSON object`.
- `.versions` in a URL: `403`.
- A `.score` upload where the copy to top level fails leaves the version on disk
  and returns `500` with the OS error; the next upload repairs the copy.

## Tests (`node cli/remote.test.js`, against the real serve.py as today)

Hub API:
1. three PUTs of different bytes → replies say v1, v2, v3; `?versions` lists three, latest 3
2. plain `GET` is v3's bytes; `?v=1` is v1's; `?v=7` is 404
3. identical bytes PUT again → v4 (always a new version)
4. `PUT ?meta&v=2` with an object → 204; `GET ?meta&v=2` returns it; `GET ?meta&v=1` returns `{}`
5. `GET ?v=2` parses as JSON with `author_metadata` equal to what was stored; `GET ?v=2&raw` equals the uploaded bytes exactly
6. metadata on the latest → plain `GET` carries `author_metadata`; `HEAD` content-length equals that merged body
7. `PUT ?meta` with `[1,2]` → 400; with `not json` → 400 mentioning the parse error; nothing stored
8. a `.score` that is not JSON → downloads unchanged even with metadata; `?versions` says `mergeable: false`
9. `?json` listing hides `.versions` and shows `version` and `has_metadata` on the row
10. `GET /hub/score/.versions/levels.score/1.score` → 403
11. a `.txt` PUT twice overwrites; `?versions` on it → 400

CLI:
12. `pull levels.score@1` writes v1's bytes; `pull levels.score` writes the merged latest
13. `pull levels.score@9` exits 1 and lists the versions
14. `push` output ends with `, vN)`

The page is driven once in headless Chrome after the API passes: expand
versions, add metadata to a version, download it, confirm `author_metadata` is
in the downloaded file.

## Out of scope

Deleting versions, diffing versions, metadata on folders, a metadata schema,
per-user attribution (the hub has no users), and versioning for non-`.score`
files.
