# Rust test fixtures

Generated silence (0.1 seconds, mono, 44100 Hz) and a 2×2 black cover image. No external music or artwork is included. Tests do not require FFmpeg at runtime.

Generated with FFmpeg 9.0.2:

```sh
for ext in mp3 aac m4a ogg flac; do
  ffmpeg -f lavfi -i 'anullsrc=r=44100:cl=mono:d=0.1' "silence.$ext"
done
ffmpeg -f lavfi -i 'color=c=black:s=2x2:d=0.04' -frames:v 1 cover.png
```

The OGG fixture also covers the `.oga` extension. WAV PCM is generated directly in tests.
