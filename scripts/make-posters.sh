#!/usr/bin/env bash
# Cut poster stills from a local master at three widths.
#
#   ./scripts/make-posters.sh media/the-long-quiet.mov the-long-quiet 00:01:23
#
# Requires ffmpeg on YOUR machine. It is NOT a build dependency — build.mjs
# never invokes it. See docs/06-MEDIA-PIPELINE.md.
set -euo pipefail

SRC="${1:?usage: make-posters.sh <master-file> <film-id> <timestamp>}"
ID="${2:?missing film id}"
TS="${3:-00:00:01}"

[ -f "$SRC" ] || { echo "No such file: $SRC" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not found. Install it, then retry." >&2; exit 1; }

case "$ID" in
  *[!a-z0-9-]*|-*|*-) echo "Film id must be a lowercase slug: $ID" >&2; exit 1 ;;
esac

OUT="assets/stills"
mkdir -p "$OUT"

for W in 960 1440 1920; do
  # -ss before -i seeks fast; -2 keeps height even; -q:v 3 is a good stills tradeoff.
  ffmpeg -loglevel error -y -ss "$TS" -i "$SRC" -frames:v 1 \
         -vf "scale=${W}:-2:flags=lanczos" -q:v 3 "$OUT/${ID}-${W}.jpg"
  printf '  %-38s %s\n' "$OUT/${ID}-${W}.jpg" "$(du -h "$OUT/${ID}-${W}.jpg" | cut -f1)"
done

echo
echo "Done. Budget is 300 KB per file — the build fails past that."
echo "Now point films.json at:  \"poster\": { \"src\": \"$OUT/${ID}-1920.jpg\", \"alt\": \"...\" }"
