# `limelight push` / `limelight pull` — design

Two commands that move a `.score` file between a machine and a shared folder
everyone on the network can read. The shared folder today is a dufs 0.46 file
server at `http://192.168.1.42:5000/`, in a `score/` directory. Tomorrow it may
be cloud storage; the commands must not care.

## What exists

- A score is a JSON file — `protocol/score.levels.json` is the only example —
  carrying `grid.bpm`, `grid.first_beat_s`, `grid.beats_per_bar`, `song`, and
  `made_by`. On the wire and on disk it will be named `<slug>.score`.
- There is no `limelight` command yet, on any branch. These are its first two
  subcommands.
- The dufs web UI, observed with Playwright with every write intercepted, uses
  plain HTTP, no auth, no CSRF:

  | action | request |
  |---|---|
  | upload | `PUT /<dir>/<name>` — raw file bytes as the body |
  | new folder | `MKCOL /<dir>` |
  | list | `GET /<dir>?json` → `{ paths: [{ name, path_type, size, mtime }] }` |
  | download | `GET /<dir>/<name>` |

  The server allows upload and forbids delete. Overwriting is therefore the only
  way to correct a bad push, and the commands must allow it.

## Commands

```
limelight push <path/to/file.score>     upload to <remote>/<basename>
limelight pull <name.score>             download <remote>/<name.score> into the current directory
limelight                               print usage, exit 1
```

- `push` requires the file to exist and to end in `.score`. Nothing else is
  checked (the user's decision: extension only). The file is uploaded under its
  basename. An existing file of that name on the server is overwritten silently
  (the user's decision). After the PUT, a `HEAD` on the same URL must report a
  `content-length` equal to the local size; a mismatch is reported as a failure,
  because a truncated upload that looks like a success is the expensive kind.
- `pull` takes a name, not a path; any directory part is stripped. The file is
  written to the current working directory, overwriting a local file of the
  same name. If the server has no such file, the command prints the names it
  does have and exits 1 — the miss doubles as the listing.
- Output is one line per success: `pushed levels.score → http://…/score/levels.score (487 bytes)` /
  `pulled levels.score ← http://…/score/levels.score (487 bytes)`.

Exit codes: `0` success · `1` usage error, bad input, name not on server ·
`2` remote unreachable or returned an error.

## Configuration

One environment variable, matching `LIMELIGHT_MAPS` on `main`:

```
LIMELIGHT_REMOTE   default http://192.168.1.42:5000/score
```

The value is a URL to the *folder* that holds scores. Its scheme selects the
backend: `http:` and `https:` are dufs today. A future `s3://bucket/prefix` or
`gs://…` adds a module and a case in one switch; the commands do not change.

Anyone can host an equivalent folder for their own network with
`dufs -A -b 0.0.0.0 -p 5000 <dir>` and point `LIMELIGHT_REMOTE` at it. This
project does not ship a server.

## Structure

```
limelight              the CLI: argv → command, messages, exit codes. Node, no dependencies.
cli/remote.js          openRemote(url) → { list(), put(name, bytes), get(name), size(name) }
                       dufs implementation chosen by URL scheme.
cli/remote.test.js     the dufs backend and both commands against a fake dufs on 127.0.0.1
```

`cli/remote.js` — the seam:

- `list()` → `GET <base>/?json`, returns `[name…]` of `path_type: "File"`.
  A 404 means the folder does not exist yet and returns `[]`.
- `put(name, bytes)` → if `list()` reported a missing folder, `MKCOL <base>`
  first (2xx or 405 "already exists" both count as done); then
  `PUT <base>/<encodeURIComponent(name)>` with the bytes; non-2xx throws.
- `get(name)` → `GET <base>/<encoded name>`; 404 throws `NotFound`; returns bytes.
- `size(name)` → `HEAD`, returns `content-length` as a number, or `null` on 404.

Everything uses Node's built-in `fetch` (Node ≥ 18; the machine has 24).
URL building mirrors the dufs client exactly: base without trailing slash plus
`/` plus the per-segment `encodeURIComponent` of the name.

## Errors — surfaced, never silent

- Connection refused / timeout: `cannot reach http://192.168.1.42:5000/score — is the server up? Override with LIMELIGHT_REMOTE=<url>`, exit 2.
- Non-2xx from the server: `PUT http://…/levels.score → 507 Insufficient Storage` plus the first line of the body, exit 2.
- Local file missing or not `.score`: one line saying which, exit 1.
- Size mismatch after push: `uploaded 487 bytes but the server holds 210 — push again`, exit 2.

## Testing

`node cli/remote.test.js` starts a fake dufs (Node `http`, in-memory files)
that implements `GET ?json`, `MKCOL`, `PUT`, `GET`, `HEAD` with dufs's status
codes, then checks:

1. push a `.score` → it appears in `list()` with identical bytes and the folder was created by MKCOL
2. push the same name again → bytes replaced, no error
3. pull → file written to a temp cwd, bytes identical
4. pull a missing name → exit 1, stderr lists the names present
5. push a non-`.score` path → exit 1, nothing sent
6. remote unreachable (closed port) → exit 2 with the LIMELIGHT_REMOTE hint

Tests run the CLI as a child process with `LIMELIGHT_REMOTE` pointed at the
fake, so the messages and exit codes are what is tested, not just the module.
The shared server at 192.168.1.42 is never touched by tests. The first real
push of `protocol/score.levels.json` as `levels.score` is done once, by hand,
after the tests pass, and creates the `score/` folder.

## Out of scope

A `list` command, authentication, deletion, hosting a server, validating the
score's contents, and a Python port. Each is a one-file change later if wanted.
