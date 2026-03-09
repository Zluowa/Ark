#!/bin/bash
# Assemble Ark distribution package
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist/Ark"

echo "=== Assembling Ark Distribution ==="

# 1. Copy Island
echo "[1/5] Copying Island binary..."
cp "$ROOT/desktop/target/release/omniagent-island.exe" "$DIST/island/"
cp -r "$ROOT/desktop/island/resources/"* "$DIST/island/resources/"
echo "  Island: $(du -sh "$DIST/island/omniagent-island.exe" | cut -f1)"

# 2. Copy Node.js
echo "[2/5] Copying Node.js runtime..."
cp "/c/Program Files/nodejs/node.exe" "$DIST/"
echo "  Node.js: $(du -sh "$DIST/node.exe" | cut -f1)"

# 3. Copy Next.js standalone
echo "[3/5] Copying Next.js standalone backend..."
STANDALONE="$ROOT/app/.next/standalone"
if [ ! -d "$STANDALONE" ]; then
    echo "  ERROR: standalone build not found at $STANDALONE"
    exit 1
fi
# Copy standalone server
cp "$STANDALONE/server.js" "$DIST/backend/"
# Copy node_modules from standalone
cp -r "$STANDALONE/node_modules" "$DIST/backend/"
# Copy .next output
mkdir -p "$DIST/backend/.next"
cp -r "$ROOT/app/.next/static" "$DIST/backend/.next/"
# Copy standalone .next (server chunks etc)
if [ -d "$STANDALONE/.next" ]; then
    cp -r "$STANDALONE/.next/"* "$DIST/backend/.next/"
fi
# Copy public assets if exist
if [ -d "$ROOT/app/public" ]; then
    cp -r "$ROOT/app/public" "$DIST/backend/"
fi
echo "  Backend: $(du -sh "$DIST/backend" | cut -f1)"

# 4. Copy tools
echo "[4/5] Copying tools (ffmpeg, yt-dlp)..."
FFMPEG_DIR="/c/Users/admin/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.0.1-full_build/bin"
cp "$FFMPEG_DIR/ffmpeg.exe" "$DIST/tools/"
cp "$FFMPEG_DIR/ffprobe.exe" "$DIST/tools/"
cp "/c/Users/admin/AppData/Local/Programs/Python/Python312/Scripts/yt-dlp.exe" "$DIST/tools/"
echo "  ffmpeg: $(du -sh "$DIST/tools/ffmpeg.exe" | cut -f1)"
echo "  ffprobe: $(du -sh "$DIST/tools/ffprobe.exe" | cut -f1)"
echo "  yt-dlp: $(du -sh "$DIST/tools/yt-dlp.exe" | cut -f1)"

# 5. Summary
echo ""
echo "[5/5] Distribution summary:"
echo "  Total: $(du -sh "$DIST" | cut -f1)"
echo ""
ls -la "$DIST/"
echo ""
echo "=== Assembly complete ==="
echo "Run: $DIST/start.bat"
