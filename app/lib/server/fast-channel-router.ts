type MatchScore = {
  toolId: string;
  confidence: number;
  reasons: string[];
};

type FastChannelDecision = {
  matched: boolean;
  threshold: number;
  toolId?: string;
  confidence: number;
  reasons: string[];
  suggestions: MatchScore[];
};

type AnalyzeOptions = {
  prompt?: string;
  explicitToolId?: string;
  threshold?: number;
};

type IntentRule = {
  toolId: string;
  terms: Array<{
    token: string;
    weight: number;
    reason: string;
  }>;
};

const TOOL_ALIASES: Record<string, string> = {
  pdf_compress: "official.pdf.compress",
  pdf_merge: "official.pdf.merge",
  pdf_split: "official.pdf.split",
  image_compress: "official.image.compress",
  image_convert: "official.image.convert",
  image_crop: "official.image.crop",
  video_transcode: "official.video.transcode",
  video_extract_audio: "official.video.extract_audio",
  video_clip: "official.video.clip",
  json_format: "official.utility.json_format",
  "official.utility.json-format": "official.utility.json_format",
  "official.video.extract-audio": "official.video.extract_audio",
};

const DEFAULT_THRESHOLD = 0.55;

const RULES: IntentRule[] = [
  {
    toolId: "official.pdf.compress",
    terms: [
      { token: "pdf", weight: 0.24, reason: "mentions pdf" },
      { token: "compress", weight: 0.4, reason: "mentions compress" },
      { token: "压缩", weight: 0.4, reason: "mentions 压缩" },
      { token: "reduce size", weight: 0.32, reason: "mentions reduce size" },
      { token: "瘦身", weight: 0.3, reason: "mentions 瘦身" },
    ],
  },
  {
    toolId: "official.pdf.merge",
    terms: [
      { token: "pdf", weight: 0.2, reason: "mentions pdf" },
      { token: "merge", weight: 0.42, reason: "mentions merge" },
      { token: "combine", weight: 0.32, reason: "mentions combine" },
      { token: "合并", weight: 0.42, reason: "mentions 合并" },
      { token: "拼接", weight: 0.34, reason: "mentions 拼接" },
    ],
  },
  {
    toolId: "official.pdf.split",
    terms: [
      { token: "pdf", weight: 0.2, reason: "mentions pdf" },
      { token: "split", weight: 0.42, reason: "mentions split" },
      {
        token: "extract pages",
        weight: 0.32,
        reason: "mentions extract pages",
      },
      { token: "拆分", weight: 0.42, reason: "mentions 拆分" },
      { token: "分割", weight: 0.32, reason: "mentions 分割" },
    ],
  },
  {
    toolId: "official.image.compress",
    terms: [
      { token: "image", weight: 0.2, reason: "mentions image" },
      { token: "photo", weight: 0.16, reason: "mentions photo" },
      { token: "compress", weight: 0.34, reason: "mentions compress" },
      { token: "图片", weight: 0.22, reason: "mentions 图片" },
      { token: "压缩", weight: 0.34, reason: "mentions 压缩" },
    ],
  },
  {
    toolId: "official.image.convert",
    terms: [
      { token: "image", weight: 0.2, reason: "mentions image" },
      { token: "convert", weight: 0.34, reason: "mentions convert" },
      { token: "format", weight: 0.28, reason: "mentions format" },
      { token: "jpg", weight: 0.24, reason: "mentions jpg" },
      { token: "png", weight: 0.24, reason: "mentions png" },
      { token: "webp", weight: 0.24, reason: "mentions webp" },
      { token: "图片格式", weight: 0.36, reason: "mentions 图片格式" },
      { token: "转格式", weight: 0.32, reason: "mentions 转格式" },
    ],
  },
  {
    toolId: "official.image.crop",
    terms: [
      { token: "image", weight: 0.18, reason: "mentions image" },
      { token: "crop", weight: 0.4, reason: "mentions crop" },
      { token: "trim", weight: 0.28, reason: "mentions trim" },
      { token: "裁剪", weight: 0.4, reason: "mentions 裁剪" },
      { token: "截取图片", weight: 0.32, reason: "mentions 截取图片" },
    ],
  },
  {
    toolId: "official.video.transcode",
    terms: [
      { token: "video", weight: 0.2, reason: "mentions video" },
      { token: "视频", weight: 0.24, reason: "mentions 视频" },
      { token: "transcode", weight: 0.4, reason: "mentions transcode" },
      { token: "re-encode", weight: 0.28, reason: "mentions re-encode" },
      { token: "转码", weight: 0.4, reason: "mentions 转码" },
      { token: "视频格式", weight: 0.32, reason: "mentions 视频格式" },
    ],
  },
  {
    toolId: "official.video.extract_audio",
    terms: [
      { token: "video", weight: 0.18, reason: "mentions video" },
      { token: "视频", weight: 0.2, reason: "mentions 视频" },
      { token: "audio", weight: 0.28, reason: "mentions audio" },
      { token: "extract", weight: 0.28, reason: "mentions extract" },
      { token: "mp3", weight: 0.3, reason: "mentions mp3" },
      { token: "提取音频", weight: 0.42, reason: "mentions 提取音频" },
      { token: "视频转音频", weight: 0.42, reason: "mentions 视频转音频" },
    ],
  },
  {
    toolId: "official.video.clip",
    terms: [
      { token: "video", weight: 0.2, reason: "mentions video" },
      { token: "视频", weight: 0.22, reason: "mentions 视频" },
      { token: "clip", weight: 0.34, reason: "mentions clip" },
      { token: "trim", weight: 0.28, reason: "mentions trim" },
      { token: "cut", weight: 0.24, reason: "mentions cut" },
      { token: "截取", weight: 0.34, reason: "mentions 截取" },
      { token: "片段", weight: 0.24, reason: "mentions 片段" },
    ],
  },
  {
    toolId: "official.utility.json_format",
    terms: [
      { token: "json", weight: 0.34, reason: "mentions json" },
      { token: "format", weight: 0.3, reason: "mentions format" },
      { token: "prettify", weight: 0.28, reason: "mentions prettify" },
      { token: "beautify", weight: 0.28, reason: "mentions beautify" },
      { token: "格式化", weight: 0.36, reason: "mentions 格式化" },
      { token: "美化", weight: 0.28, reason: "mentions 美化" },
    ],
  },
];

const normalizeToolId = (toolId: string): string => {
  const normalized = toolId.trim();
  if (!normalized) return normalized;
  return TOOL_ALIASES[normalized.toLowerCase()] ?? normalized;
};

const calculateScores = (prompt: string): MatchScore[] => {
  const normalizedPrompt = prompt.trim().toLowerCase();
  if (!normalizedPrompt) {
    return [];
  }

  const scores: MatchScore[] = [];
  for (const rule of RULES) {
    let confidence = 0;
    const reasons: string[] = [];

    for (const term of rule.terms) {
      if (!normalizedPrompt.includes(term.token)) {
        continue;
      }
      confidence += term.weight;
      reasons.push(term.reason);
    }

    if (
      rule.toolId.startsWith("official.pdf") &&
      normalizedPrompt.includes("pdf")
    ) {
      confidence += 0.05;
    }
    if (
      rule.toolId.startsWith("official.image") &&
      (normalizedPrompt.includes("image") || normalizedPrompt.includes("图片"))
    ) {
      confidence += 0.05;
    }
    if (
      rule.toolId.startsWith("official.video") &&
      (normalizedPrompt.includes("video") || normalizedPrompt.includes("视频"))
    ) {
      confidence += 0.05;
    }

    if (confidence > 0) {
      scores.push({
        toolId: rule.toolId,
        confidence: Math.max(0, Math.min(0.99, Number(confidence.toFixed(2)))),
        reasons,
      });
    }
  }

  return scores.sort((a, b) => b.confidence - a.confidence);
};

export const analyzeFastChannel = (
  options: AnalyzeOptions,
): FastChannelDecision => {
  const threshold =
    typeof options.threshold === "number" && Number.isFinite(options.threshold)
      ? Math.max(0, Math.min(1, options.threshold))
      : DEFAULT_THRESHOLD;

  const explicitTool = options.explicitToolId?.trim();
  if (explicitTool) {
    return {
      matched: true,
      threshold,
      toolId: normalizeToolId(explicitTool),
      confidence: 1,
      reasons: ["explicit tool id provided"],
      suggestions: [],
    };
  }

  const prompt = options.prompt?.trim() ?? "";
  const scores = calculateScores(prompt);
  const top = scores[0];
  if (!top || top.confidence < threshold) {
    return {
      matched: false,
      threshold,
      confidence: top?.confidence ?? 0,
      reasons: top?.reasons ?? [],
      suggestions: scores.slice(0, 3),
    };
  }

  return {
    matched: true,
    threshold,
    toolId: top.toolId,
    confidence: top.confidence,
    reasons: top.reasons,
    suggestions: scores.slice(1, 4),
  };
};
