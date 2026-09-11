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

Scores live in one folder everyone on the network can read. Today that is a
dufs file server at `http://192.168.1.42:5000/score`; anyone can host the
same with `dufs -A -b 0.0.0.0 -p 5000 <dir>` and point `LIMELIGHT_REMOTE`
at it. Cloud storage later is a new backend in `cli/remote.js`, not a new
command.

```
./limelight push protocol/levels.score      # upload under its basename, overwriting
./limelight pull levels.score               # download into the current directory
LIMELIGHT_REMOTE=http://host:5000/score ./limelight pull levels.score
```

A pull of a name that is not there prints the names that are. `push` checks
the server holds exactly the bytes it sent. `node cli/remote.test.js` runs
both commands against a fake server and never touches the shared one.
