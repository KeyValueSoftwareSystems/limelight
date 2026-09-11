#!/usr/bin/env bash
# Stack two edits of the same song, labelled, sharing one audio track.
#   tools/sidebyside.sh WITHOUT.mp4 WITH.mp4 OUT.mp4
set -euo pipefail
A="$1"; B="$2"; OUT="$3"
LA="${4:-WITHOUT the map — cuts on a timer}"
LB="${5:-WITH the map}"
FC="
[0:v]scale=640:360,drawtext=text='__LA__':x=12:y=12:
fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6[a];
[1:v]scale=640:360,drawtext=text='__LB__':x=12:y=12:
fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6[b];
[a][b]vstack=inputs=2[v]"
FC="${FC//__LA__/$LA}"; FC="${FC//__LB__/$LB}"
ffmpeg -y -v error -i "$A" -i "$B" -filter_complex "$FC" -map "[v]" -map 1:a -c:v libx264 -crf 20 -preset medium \
  -pix_fmt yuv420p -c:a aac -b:a 160k "$OUT"
