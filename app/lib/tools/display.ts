// @input: v5 engine ToolCategory strings
// @output: icon names, colors, labels for UI rendering
// @position: Static display metadata; consumed by tool-card and search-bar

import type { ToolCategory } from "@/lib/engine/types";

export type ToolDisplay = {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  tags: string[];
  paramCount: number;
  outputType: string;
};

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  pdf:              "PDF",
  image:            "Image",
  video:            "Video",
  audio:            "Audio",
  convert:          "Convert",
  encode:           "Encode",
  hash:             "Hash",
  generate:         "Generate",
  net:              "Network",
  "saas.international": "SaaS",
  "saas.china":     "SaaS CN",
};

export const CATEGORY_COLORS: Record<ToolCategory, string> = {
  pdf:              "bg-red-500/10 text-red-400",
  image:            "bg-blue-500/10 text-blue-400",
  video:            "bg-purple-500/10 text-purple-400",
  audio:            "bg-orange-500/10 text-orange-400",
  convert:          "bg-teal-500/10 text-teal-400",
  encode:           "bg-yellow-500/10 text-yellow-400",
  hash:             "bg-lime-500/10 text-lime-400",
  generate:         "bg-emerald-500/10 text-emerald-400",
  net:              "bg-sky-500/10 text-sky-400",
  "saas.international": "bg-indigo-500/10 text-indigo-400",
  "saas.china":     "bg-pink-500/10 text-pink-400",
};

// Lucide icon names — resolved in ToolCard via a map to avoid dynamic imports
export const CATEGORY_ICONS: Record<ToolCategory, string> = {
  pdf:              "FileText",
  image:            "Image",
  video:            "Film",
  audio:            "Music",
  convert:          "ArrowLeftRight",
  encode:           "Lock",
  hash:             "Hash",
  generate:         "Sparkles",
  net:              "Globe",
  "saas.international": "Plug",
  "saas.china":     "Plug",
};

// Display categories shown in the filter bar (no saas in the v5 free tools)
export const DISPLAY_CATEGORIES: Array<"All" | ToolCategory> = [
  "All", "pdf", "image", "video", "audio", "convert", "encode", "hash", "generate", "net",
];
