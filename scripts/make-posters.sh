#!/usr/bin/env bash
# Cut poster stills from a local master, or resize a still you already have.
#
#   ./scripts/make-posters.sh media/the-long-quiet.mov the-long-quiet 00:01:23
#   ./scripts/make-posters.sh ~/Desktop/shot.png qutub-minar
#
# The second form matters for the vertical films: pause the Short, screenshot a
# frame, point this at the PNG. Any still works — it does not have to be video.
#
# Requires ffmpeg on YOUR machine. It is NOT a build dependency — build.mjs
# never invokes it. See docs/06-MEDIA-PIPELINE.md.
set -euo pipefail

SRC="${1:?usage: make-posters.sh <master-file-or-image> <film-id> [timestamp]}"
ID="${2:?missing film id}"
TS="${3:-}"

[ -f "$SRC" ] || { echo "No such file: $SRC" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not found. Install it, then retry." >&2; exit 1; }

case "$ID" in
  *[!a-z0-9-]*|-*|*-) echo "Film id must be a lowercase slug: $ID" >&2; exit 1 ;;
esac

OUT="assets/stills"
mkdir -p "$OUT"

# Orientation decides the width ladder. A 9:16 still rendered at 1920 wide is
# 3413 tall — many times the size budget, for a frame the page caps at 21rem.
# Portrait tops out at its native 1080. build.mjs probes both ladders, so
# either set is picked up with no JSON edit.
# ffprobe ships with ffmpeg on most builds but not all (pip's imageio-ffmpeg,
# for one, gives you the encoder alone). Fall back to parsing ffmpeg's own
# stream line, which always carries WIDTHxHEIGHT.
if command -v ffprobe >/dev/null; then
  DIM=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
                -of csv=p=0:s=x "$SRC" 2>/dev/null || true)
else
  DIM=$(ffmpeg -hide_banner -i "$SRC" 2>&1 \
        | grep -o 'Video:.*' | grep -oE '[0-9]{2,5}x[0-9]{2,5}' | head -1 || true)
fi
SRC_W="${DIM%x*}"; SRC_H="${DIM#*x}"

if [ -n "$SRC_W" ] && [ -n "$SRC_H" ] && [ "$SRC_H" -gt "$SRC_W" ]; then
  WIDTHS="640 810 1080"
  echo "  portrait source (${SRC_W}x${SRC_H}) — emitting 640/810/1080"
else
  WIDTHS="960 1440 1920"
  echo "  landscape source (${SRC_W:-?}x${SRC_H:-?}) — emitting 960/1440/1920"
fi

# Seeking into a single-frame still lands past the end and writes nothing, so
# -ss is used only when a timestamp was actually asked for.
SEEK=()
if [ -n "$TS" ]; then
  SEEK=(-ss "$TS")
elif [ -n "${SRC_H:-}" ]; then
  case "${SRC,,}" in
    *.png|*.jpg|*.jpeg|*.webp|*.tif|*.tiff|*.bmp) : ;;   # a still: start at 0
    *) SEEK=(-ss 00:00:01) ;;                            # video: skip the black frame
  esac
fi

# Drop rungs wider than the source and add the native width, so no file is
# ever upscaled and no filename claims a width the image does not have.
# build.mjs reads the actual widths off disk, so any set works.
if [ -n "${SRC_W:-}" ]; then
  KEPT=""; MAX=0
  for W in $WIDTHS; do
    if [ "$W" -lt "$SRC_W" ]; then KEPT="$KEPT $W"; MAX="$W"; fi
  done
  if [ -z "$KEPT" ]; then
    WIDTHS="$SRC_W"                                  # narrower than every rung
  elif [ "$SRC_W" -gt "$(( MAX * 115 / 100 ))" ]; then
    WIDTHS="$KEPT $SRC_W"                            # meaningfully bigger: keep it
  else
    WIDTHS="$KEPT"                                   # within 15% of a rung: redundant
  fi
  echo "  source is ${SRC_W}px wide — emitting:$WIDTHS"
fi

OVER=0
for W in $WIDTHS; do
  # Never upscale: a 1080-wide screenshot asked for at 1440 would be softened
  # for nothing. min() keeps the source width as the ceiling.
  # -ss before -i seeks fast; -2 keeps height even; -q:v 3 is a good tradeoff.
  ffmpeg -loglevel error -y "${SEEK[@]}" -i "$SRC" -frames:v 1 \
         -vf "scale='min(${W},iw)':-2:flags=lanczos" -q:v 3 "$OUT/${ID}-${W}.jpg"
  SIZE=$(du -k "$OUT/${ID}-${W}.jpg" | cut -f1)
  [ "$SIZE" -gt 300 ] && OVER=1
  printf '  %-38s %s\n' "$OUT/${ID}-${W}.jpg" "$(du -h "$OUT/${ID}-${W}.jpg" | cut -f1)"
done

echo
if [ "$OVER" -eq 1 ]; then
  echo "  One or more files exceed the 300 KB budget. The build WARNS, it does not"
  echo "  fail — but shrink them anyway: re-run with -q:v 5, or export smaller."
fi
echo "Done. No JSON edit needed: build.mjs finds assets/stills/${ID}-*.jpg by name."
echo "Run 'node build.mjs' and the poster warning for '${ID}' should disappear."
