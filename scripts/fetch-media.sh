#!/usr/bin/env bash
# Pull one of YOUR OWN uploads into media/ for re-editing.
#
#   ./scripts/fetch-media.sh https://vimeo.com/123456789
#
# media/ is gitignored and must never be committed. This script is for Nitish's
# own uploads only — do not use it to fetch anyone else's work.
set -euo pipefail

URL="${1:?usage: fetch-media.sh <url-to-your-own-upload>}"

command -v yt-dlp >/dev/null || { echo "yt-dlp not found. Install it, then retry." >&2; exit 1; }

DEST="media"
mkdir -p "$DEST"

# Refuse to write anywhere tracked.
git check-ignore -q "$DEST" || {
  echo "Refusing to run: $DEST/ is not gitignored. Video must never reach a commit." >&2
  exit 1
}

yt-dlp -f 'bv*+ba/b' -o "$DEST/%(title)s.%(ext)s" -- "$URL"

echo
echo "Saved into $DEST/ (gitignored)."
echo "Next: ./scripts/make-posters.sh $DEST/<file> <film-id> <timestamp>"
