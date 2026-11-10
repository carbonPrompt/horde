#!/usr/bin/env bash
# Pack rendered sound effects (WAV from the sfx generator) into assets/sfx/*.ogg (Opus) for the build.
# Usage: tools/pack-sfx.sh <dir with WAVs>. Trims trailing silence and fades the tail; loops keep their full length.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=$1
LOOPS="horde-far-1 horde-close-1 crowd-panic-1 crowd-far-1 fire-1 siren-1"
for w in "$SRC"/*.wav; do
  n=$(basename "$w" .wav)
  if [[ " $LOOPS " == *" $n "* ]]; then
    ffmpeg -loglevel error -y -i "$w" -af "loudnorm=I=-22:TP=-2" -ar 48000 -c:a libopus -b:a 56k "assets/sfx/$n.ogg"
  else
    ffmpeg -loglevel error -y -i "$w" -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,afade=t=in:d=0.08,areverse,loudnorm=I=-16:TP=-1.5" -ar 48000 -c:a libopus -b:a 64k "assets/sfx/$n.ogg"
  fi
done
du -ch assets/sfx/*.ogg | tail -1
