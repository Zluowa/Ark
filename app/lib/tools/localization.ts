// @input: Tool manifest/display info + current locale
// @output: localized tool name/description and output type labels
// @position: shared localization helper for tools pages/components

type ToolLocale = "zh" | "en";

type LocalizedToolText = {
  name: string;
  description: string;
};

const TOOL_ZH_TEXTS: Record<string, LocalizedToolText> = {
  "audio.compress": {
    name: "音频压缩",
    description: "通过降低比特率来压缩音频体积。",
  },
  "audio.convert": {
    name: "音频格式转换",
    description: "在 MP3、WAV、FLAC、AAC 之间转换音频格式。",
  },
  "audio.normalize": {
    name: "音频响度标准化",
    description: "使用 loudnorm 滤镜统一音频响度。",
  },
  "audio.trim": {
    name: "音频裁剪",
    description: "按起止时间裁剪音频片段。",
  },
  "convert.csv_json": {
    name: "CSV 转 JSON",
    description: "将 CSV 字符串转换为 JSON 数组。",
  },
  "convert.json_csv": {
    name: "JSON 转 CSV",
    description: "将 JSON 数组转换为 CSV 格式。",
  },
  "convert.json_format": {
    name: "JSON 美化/压缩",
    description: "对 JSON 字符串进行格式化或压缩。",
  },
  "convert.json_yaml": {
    name: "JSON 转 YAML",
    description: "将 JSON 字符串转换为 YAML 格式。",
  },
  "convert.md_html": {
    name: "Markdown 转 HTML",
    description: "将 Markdown 文本转换为 HTML。",
  },
  "convert.yaml_json": {
    name: "YAML 转 JSON",
    description: "将 YAML 字符串转换为 JSON 格式。",
  },
  "decode.base64": {
    name: "Base64 转文本",
    description: "将 Base64 字符串解码为文本。",
  },
  "decode.jwt": {
    name: "JWT 解码",
    description: "解析 JWT 的头部与载荷（不进行签名校验）。",
  },
  "decode.url": {
    name: "URL 解码",
    description: "对 URL 编码（百分号编码）字符串进行解码。",
  },
  "dev.diff": {
    name: "Diff 对比器",
    description: "以并排或统一视图比较文本差异。",
  },
  "dev.run_code": {
    name: "代码沙盒",
    description: "在沙盒环境中编写并运行 JavaScript 代码。",
  },
  "dev.sandbox": {
    name: "实时预览沙盒",
    description: "基于 Sandpack 的 React 在线编辑与实时预览。",
  },
  "encode.base64": {
    name: "文本转 Base64",
    description: "将文本编码为 Base64 字符串。",
  },
  "encode.url": {
    name: "URL 编码",
    description: "对字符串进行 URL 编码（百分号编码）。",
  },
  "generate.canvas": {
    name: "矢量画布",
    description: "打开 tldraw 矢量画布，用于绘图与示意图制作。",
  },
  "generate.chart": {
    name: "图表构建器",
    description: "创建柱状图、折线图、饼图、散点图等交互图表。",
  },
  "generate.color_palette": {
    name: "生成配色方案",
    description: "根据基础颜色生成协调的色板。",
  },
  "generate.countdown": {
    name: "倒计时",
    description: "创建指向目标日期/时间的倒计时。",
  },
  "generate.dashboard": {
    name: "数据看板",
    description: "构建包含 KPI、图表和表格的数据看板。",
  },
  "generate.diagram": {
    name: "图表编辑器",
    description: "创建和编辑 Mermaid 图（流程图、时序图等）。",
  },
  "generate.document": {
    name: "文档编辑器",
    description: "支持 Slash 命令的富文本块编辑器。",
  },
  "generate.excalidraw": {
    name: "Excalidraw 画板",
    description: "打开交互式矢量白板（Excalidraw 风格）。",
  },
  "generate.flashcards": {
    name: "抽认卡",
    description: "创建带翻转动画的交互式学习卡片。",
  },
  "generate.flow": {
    name: "流程编辑器",
    description: "通过拖拽构建节点式流程图。",
  },
  "generate.graph": {
    name: "关系图查看器",
    description: "可视化展示节点与连线构成的关系网络。",
  },
  "generate.habits": {
    name: "习惯追踪",
    description: "创建支持每日打卡与连续记录的习惯面板。",
  },
  "generate.image": {
    name: "AI 图片生成",
    description: "基于文本提示词生成 AI 图片（DALL·E 3）。",
  },
  "generate.kanban": {
    name: "看板",
    description: "创建包含列与任务卡片的交互式看板。",
  },
  "generate.mindmap": {
    name: "思维导图",
    description: "创建中心主题与分支结构的可视化导图。",
  },
  "generate.password": {
    name: "生成随机密码",
    description: "生成加密安全的随机密码。",
  },
  "generate.pomodoro": {
    name: "番茄钟",
    description: "可自定义工作与休息时长的专注计时器。",
  },
  "generate.qrcode": {
    name: "生成二维码",
    description: "将文本或 URL 生成二维码图片。",
  },
  "generate.spreadsheet": {
    name: "电子表格",
    description: "创建可编辑单元格的交互式表格。",
  },
  "generate.timestamp": {
    name: "生成时间戳",
    description: "生成多种格式的当前时间戳。",
  },
  "generate.toolkit": {
    name: "UI 工具箱",
    description: "提供取色器、计算器等交互式 UI 小工具。",
  },
  "generate.univer": {
    name: "Univer 表格",
    description: "类 Excel 电子表格，支持公式、图表与透视分析。",
  },
  "generate.uuid": {
    name: "生成 UUID v4",
    description: "批量生成随机 UUID v4。",
  },
  "generate.whiteboard": {
    name: "白板",
    description: "打开无限画布进行自由绘制。",
  },
  "generate.worldclock": {
    name: "世界时钟",
    description: "显示多个时区当前时间并提供时钟视图。",
  },
  "generate.writing": {
    name: "写作编辑器",
    description: "无干扰写作编辑器，支持 AI 辅助能力。",
  },
  "hash.md5": {
    name: "MD5 哈希",
    description: "计算字符串的 MD5 哈希值。",
  },
  "hash.password": {
    name: "密码哈希（scrypt）",
    description: "使用 scrypt 对密码进行安全哈希。",
  },
  "hash.sha256": {
    name: "SHA-256 哈希",
    description: "计算字符串的 SHA-256 哈希值。",
  },
  "hash.sha512": {
    name: "SHA-512 哈希",
    description: "计算字符串的 SHA-512 哈希值。",
  },
  "image.compress": {
    name: "图片压缩",
    description: "压缩图片文件体积并保留可控质量。",
  },
  "image.convert": {
    name: "图片格式转换",
    description: "在 PNG、JPG、WebP、AVIF 等格式间转换。",
  },
  "image.crop": {
    name: "图片裁剪",
    description: "按指定区域裁剪图片。",
  },
  "image.metadata": {
    name: "图片元数据",
    description: "读取图片尺寸、格式和文件大小等信息。",
  },
  "image.resize": {
    name: "图片尺寸调整",
    description: "将图片缩放到目标宽高。",
  },
  "image.rotate": {
    name: "图片旋转",
    description: "按指定角度旋转图片。",
  },
  "media.download_audio": {
    name: "音频提取下载",
    description: "从视频中提取 MP3 音频（支持 B 站/抖音/YouTube/小红书）。",
  },
  "media.download_video": {
    name: "视频下载",
    description: "下载视频 MP4（支持 B 站、抖音、YouTube、小红书）。",
  },
  "media.extract_subtitle": {
    name: "字幕提取",
    description: "提取视频字幕为 SRT（目前仅支持 B 站官方字幕）。",
  },
  "media.video_info": {
    name: "视频信息查询",
    description: "获取视频标题、时长、封面等信息（B 站/抖音/YouTube/小红书）。",
  },
  "net.dns_lookup": {
    name: "DNS 查询",
    description: "查询域名的 A、AAAA、MX、TXT、CNAME 等记录。",
  },
  "net.ip_info": {
    name: "IP 信息查询",
    description: "查询 IP 的地理位置与网络信息。",
  },
  "net.music_search": {
    name: "音乐搜索",
    description: "在网易云音乐中搜索歌曲信息。",
  },
  "pdf.compress": {
    name: "PDF 压缩",
    description: "压缩 PDF 文件以减小体积。",
  },
  "pdf.merge": {
    name: "PDF 合并",
    description: "将多个 PDF 合并为一个文件。",
  },
  "pdf.page_count": {
    name: "PDF 页数统计",
    description: "统计 PDF 文件总页数。",
  },
  "pdf.split": {
    name: "PDF 拆分",
    description: "按页码范围拆分 PDF 文件。",
  },
  "pdf.to_image": {
    name: "PDF 转图片",
    description: "将 PDF 指定页面转换为 PNG 图片。",
  },
  "video.compress": {
    name: "视频压缩",
    description: "使用 CRF 编码压缩视频文件体积。",
  },
  "video.convert": {
    name: "视频格式转换",
    description: "将视频转换为 MP4、WebM 或 AVI。",
  },
  "video.extract_audio": {
    name: "提取视频音频",
    description: "从视频文件中提取音轨。",
  },
  "video.to_gif": {
    name: "视频转 GIF",
    description: "将视频片段转换为 GIF 动图。",
  },
  "video.trim": {
    name: "视频裁剪",
    description: "按起止时间裁剪视频片段。",
  },
};

const OUTPUT_TYPE_LABELS: Record<string, Record<ToolLocale, string>> = {
  file: { zh: "文件", en: "File" },
  json: { zh: "JSON", en: "JSON" },
  text: { zh: "文本", en: "Text" },
  url: { zh: "链接", en: "URL" },
};

export function getLocalizedToolText(
  tool: { id: string; name: string; description: string },
  locale: ToolLocale,
): LocalizedToolText {
  if (locale === "zh" && TOOL_ZH_TEXTS[tool.id]) {
    return TOOL_ZH_TEXTS[tool.id];
  }
  return { name: tool.name, description: tool.description };
}

export function getOutputTypeLabel(outputType: string, locale: ToolLocale): string {
  return OUTPUT_TYPE_LABELS[outputType]?.[locale] ?? outputType;
}

