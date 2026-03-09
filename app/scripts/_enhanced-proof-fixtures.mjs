import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const canvasWidth = 640;
const canvasHeight = 384;

const baseSvg = `
<svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d1220"/>
      <stop offset="100%" stop-color="#151a2a"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="196" cy="172" r="94" fill="#4f7cff"/>
  <rect x="354" y="92" width="146" height="146" rx="28" fill="#efb75f"/>
  <polygon points="478,292 548,346 408,346" fill="#ff5f7a"/>
  <text x="56" y="66" fill="#f6f7fb" font-size="34" font-family="Arial, Helvetica, sans-serif" font-weight="700">OMNI REF</text>
  <text x="58" y="324" fill="#8fa4d7" font-size="22" font-family="Arial, Helvetica, sans-serif">dynamic island proof fixture</text>
</svg>
`.trim();

const watermarkOverlaySvg = (placement, label) => {
  const anchor = {
    "top-left": { x: 8, y: 8, textX: 28, textY: 36 },
    "top-right": { x: canvasWidth - 236, y: 8, textX: canvasWidth - 28, textY: 36 },
    "bottom-left": { x: 8, y: canvasHeight - 52, textX: 28, textY: canvasHeight - 24 },
    "bottom-right": { x: canvasWidth - 236, y: canvasHeight - 52, textX: canvasWidth - 28, textY: canvasHeight - 24 },
  }[placement];
  const textAnchor = placement.includes("right") ? "end" : "start";

  return `
  <svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${anchor.x}" y="${anchor.y}" width="228" height="44" rx="14" fill="rgba(255,255,255,0.18)"/>
    <text x="${anchor.textX}" y="${anchor.textY}" text-anchor="${textAnchor}" fill="rgba(255,255,255,0.92)"
      font-size="22" font-family="Arial, Helvetica, sans-serif" font-weight="700">${label}</text>
  </svg>
  `.trim();
};

const writePng = async (svg, outputPath) => {
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
};

export const createEnhancedProofFixtures = async (rootDir) => {
  fs.mkdirSync(rootDir, { recursive: true });

  const cleanImagePath = path.join(rootDir, "fixture-clean-reference.png");
  const watermarkedBottomRightPath = path.join(rootDir, "fixture-watermark-bottom-right.png");
  const watermarkedTopLeftPath = path.join(rootDir, "fixture-watermark-top-left.png");
  const textFilePath = path.join(rootDir, "fixture-notes.txt");

  await writePng(baseSvg, cleanImagePath);
  await sharp(cleanImagePath)
    .composite([
      { input: Buffer.from(watermarkOverlaySvg("bottom-right", "OMNI WATERMARK")) },
    ])
    .png()
    .toFile(watermarkedBottomRightPath);

  await sharp(cleanImagePath)
    .composite([
      { input: Buffer.from(watermarkOverlaySvg("top-left", "BATCH MARK")) },
    ])
    .png()
    .toFile(watermarkedTopLeftPath);

  fs.writeFileSync(
    textFilePath,
    [
      "OmniAgent enhanced proof fixture",
      "This file is used to verify generic file compression.",
      "The output should be a zip archive that preserves original names.",
    ].join("\n"),
    "utf8",
  );

  return {
    cleanImagePath,
    watermarkedBottomRightPath,
    watermarkedTopLeftPath,
    textFilePath,
  };
};
