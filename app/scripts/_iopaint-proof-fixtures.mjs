import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

export const dataUrlFromBuffer = (buffer, mime = "image/png") =>
  `data:${mime};base64,${buffer.toString("base64")}`;

export const writeDataUrlToFile = async (dataUrl, filePath) => {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl || "");
  if (!match) {
    throw new Error("Invalid data URL");
  }
  const buffer = Buffer.from(match[2], "base64");
  await fs.writeFile(filePath, buffer);
  return filePath;
};

export const createWatermarkFixture = async (filePath) => {
  const width = 960;
  const height = 640;
  const baseSvg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#08111c"/>
          <stop offset="55%" stop-color="#0f4aa2"/>
          <stop offset="100%" stop-color="#1a79ff"/>
        </linearGradient>
        <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fff8f2" stop-opacity="0.98"/>
          <stop offset="100%" stop-color="#d7ecff" stop-opacity="0.9"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="40" fill="url(#bg)"/>
      <circle cx="220" cy="176" r="108" fill="#ffd25f" fill-opacity="0.94"/>
      <rect x="130" y="104" width="360" height="420" rx="44" fill="url(#card)"/>
      <circle cx="310" cy="240" r="102" fill="#1c53d8"/>
      <rect x="455" y="172" width="210" height="210" rx="34" fill="#121826" fill-opacity="0.84"/>
      <rect x="492" y="209" width="136" height="136" rx="26" fill="#ff9b5b"/>
      <path d="M680 472 L820 352 L880 520 Z" fill="#ff4e7e" fill-opacity="0.92"/>
      <text x="168" y="478" fill="#0a1330" font-size="40" font-family="Arial, sans-serif" font-weight="700">MOSS cover</text>
      <text x="170" y="520" fill="#375c9b" font-size="24" font-family="Arial, sans-serif">dynamic island proof</text>
    </svg>
  `;
  const watermarkSvg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(660 126) rotate(-11)">
        <rect x="-28" y="-38" width="270" height="88" rx="24" fill="#03121f" fill-opacity="0.32"/>
        <text x="0" y="18" fill="#ffffff" fill-opacity="0.74" font-size="40" font-family="Arial, sans-serif" font-weight="800">WATERMARK</text>
      </g>
    </svg>
  `;
  await ensureDir(path.dirname(filePath));
  await sharp(Buffer.from(baseSvg))
    .png()
    .composite([{ input: Buffer.from(watermarkSvg), blend: "over" }])
    .png()
    .toFile(filePath);
  return filePath;
};

const writeSvg = async (svg, filePath) => {
  await ensureDir(path.dirname(filePath));
  await sharp(Buffer.from(svg)).png().toFile(filePath);
  return filePath;
};

export const createEditFixtureSet = async (dirPath) => {
  await ensureDir(dirPath);
  const sourcePath = path.join(dirPath, "00-source-edit.png");
  const removeMaskPath = path.join(dirPath, "01-mask-remove.png");
  const replaceMaskPath = path.join(dirPath, "02-mask-replace.png");
  const textMaskPath = path.join(dirPath, "03-mask-text.png");
  const referencePath = path.join(dirPath, "04-reference-replace.png");

  const width = 1024;
  const height = 768;

  const sourceSvg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#07101a"/>
          <stop offset="50%" stop-color="#0b2a56"/>
          <stop offset="100%" stop-color="#12253b"/>
        </linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f8fbff" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#c3dbff" stop-opacity="0.06"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="56" fill="url(#bg)"/>
      <rect x="128" y="76" width="768" height="112" rx="28" fill="url(#glass)" stroke="rgba(255,255,255,0.12)"/>
      <circle cx="300" cy="404" r="146" fill="#2f76ff"/>
      <circle cx="300" cy="404" r="96" fill="#7cb6ff" fill-opacity="0.32"/>
      <rect x="642" y="252" width="188" height="188" rx="38" fill="#ff9a52"/>
      <rect x="668" y="278" width="136" height="136" rx="28" fill="#ffd16f" fill-opacity="0.78"/>
      <path d="M704 592 L856 470 L918 640 Z" fill="#ff4f84"/>
      <text x="152" y="656" fill="#f5f8ff" font-size="52" font-family="Arial, sans-serif" font-weight="800">OMNIAGENT</text>
      <text x="154" y="702" fill="#84a9d7" font-size="26" font-family="Arial, sans-serif">island edit proof scene</text>
    </svg>
  `;

  const removeMaskSvg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="black"/>
      <rect x="618" y="228" width="236" height="236" rx="52" fill="white"/>
    </svg>
  `;

  const textMaskSvg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="black"/>
      <rect x="174" y="96" width="676" height="84" rx="18" fill="white"/>
    </svg>
  `;

  const referenceSvg = `
    <svg width="320" height="320" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
      <path d="M160 48 L258 104 L258 216 L160 272 L62 216 L62 104 Z" fill="#5ef2a8"/>
      <path d="M160 88 L222 124 L222 196 L160 232 L98 196 L98 124 Z" fill="#15a86a"/>
      <circle cx="160" cy="160" r="22" fill="#c9ffe3"/>
    </svg>
  `;

  await writeSvg(sourceSvg, sourcePath);
  await writeSvg(removeMaskSvg, removeMaskPath);
  await writeSvg(removeMaskSvg, replaceMaskPath);
  await writeSvg(textMaskSvg, textMaskPath);
  await writeSvg(referenceSvg, referencePath);

  return {
    sourcePath,
    removeMaskPath,
    replaceMaskPath,
    textMaskPath,
    referencePath,
  };
};
