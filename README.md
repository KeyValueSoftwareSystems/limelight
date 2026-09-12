# Limelight — ground zero

This branch is deliberately empty. It was started from `main` and then cleared,
so that the protocol can be built without inheriting decisions made before it
existed.

Nothing was destroyed. Every commit is still on `main`, and `git checkout main`
brings all of it back.

## Where the old work is

| what | where |
|---|---|
| everything up to the reset — readers, synth, listen, assets, briefs | `main` |
| the unfinished protocol work — plan(), session.js, mapping.js, rig.html | `protocol-wip` |

Bring a single file across without merging anything:

```
git checkout main -- path/to/file
```

## What is deliberately not here

The recordings. `synth/out/*.wav` is gitignored and always has been — rule 1,
no audio in git, ever — so the 83 MB of audio on this machine survived the
reset and is still on disk. Nothing needs re-downloading.

## What ground zero is for

The map is a file that says what a song does. A reader turns that file into an
art form. What we are rebuilding here is the layer between them: an application
declares what it can do, the layer answers in musical position rather than in
seconds, and the application owns the clock and the meaning.

## Sharing scores

`python3 serve.py` also hosts the hub at `/hub/`: one folder everyone on the
network can list, upload to, download from and make folders in, from a browser
or from the command line. It binds every interface and prints the address other
machines should use. Files live in `hub/files/`, which is not committed.

```
./limelight push protocol/levels.score      # upload under its basename, overwriting
./limelight pull levels.score               # download into the current directory
export LIMELIGHT_REMOTE=http://<host>:8770/hub/score    # from another machine; serve.py prints this line
```

A pull of a name that is not there prints the names that are. `push` checks
the server holds exactly the bytes it sent.

**Versions.** Every `.score` keeps every version it was uploaded as. `push` of
an existing name makes the next version and says so; the page shows a `vN`
badge and a *versions* list with a download for each; `./limelight pull
levels.score@2` fetches version 2, and plain `pull` is the latest. Other file
types simply overwrite.

**Metadata fields.** Click a score in the hub for its own page: every version,
a download for each, a new version from a file picker, and the metadata on any
version as named fields, each with an *enforce* checkbox. A download of that
version carries every field at the root of the JSON as `x-<name>` (a value typed
as `128` or `true` becomes a number or boolean), and one `x-enforced` list
naming the enforced keys when there are any. The uploaded bytes are never
rewritten; `?raw` on the file URL skips the merge.

`node cli/remote.test.js` starts a private serve.py on a free port and runs
both commands, the hub API, versions and metadata against it. The hub speaks
the same requests as a dufs server, so `LIMELIGHT_REMOTE` can point at one of
those instead (without versions).
