// @input: All A2UI widget components + pill metadata + error boundary
// @output: widgetRegistry (full) + toolWidgets (backward-compatible component map)
// @position: Central dispatch — maps AI SDK tool names to React widgets

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  TypeIcon, BracesIcon, FileIcon, ImageIcon, VideoIcon, MusicIcon,
  PaletteIcon, QrCodeIcon, KeyRoundIcon, BarChart3Icon, CodeIcon,
  FileTextIcon, ScrollTextIcon, GitCompareArrowsIcon, PenToolIcon,
  TimerIcon, TableIcon, GitForkIcon, DownloadIcon, SubtitlesIcon,
  LayoutDashboardIcon, NetworkIcon, HourglassIcon, CalendarCheckIcon,
  LayersIcon, GlobeIcon, PencilRulerIcon, Grid3X3Icon, SparklesIcon,
  WorkflowIcon, BoxIcon, RefreshCwIcon, LayoutListIcon, WrenchIcon,
} from "lucide-react";
import type { WidgetEntry } from "./types";
import { withErrorBoundary } from "./widget-error-boundary";
import { TextResult } from "./text-result";
import { JsonResult } from "./json-result";
import { FileResult } from "./file-result";
import { ImageStudio } from "./image-studio";
import { MediaPlayer } from "./media-player";
import { MusicPlayer } from "./music-player";
import { ColorPalette } from "./color-palette";
import { QrCodeViewer } from "./qrcode-viewer";
import { JwtViewer } from "./jwt-viewer";
import { ChartBuilder } from "./chart-builder";
import { CodePlayground } from "./code-playground";
import { MarkdownEditor } from "./markdown-editor";
import { PdfViewer } from "./pdf-viewer";
import { DiffViewer } from "./diff-viewer";
import { Whiteboard } from "./whiteboard";
import { PomodoroTimer } from "./pomodoro-timer";
import { TableResult } from "./table-result";
import { MermaidViewer } from "./mermaid-viewer";
import { VideoDownloader } from "./video-downloader";
import { SubtitleViewer } from "./subtitle-viewer";
import { KanbanBoard } from "./kanban-board";
import { MindMap } from "./mind-map";
import { CountdownTimer } from "./countdown-timer";
import { HabitTracker } from "./habit-tracker";
import { FlashcardDeck } from "./flashcard-deck";
import { WorldClock } from "./world-clock";
import { ExcalidrawBoard } from "./excalidraw-board";
import { SpreadsheetGrid } from "./spreadsheet-grid";
import { ImageGenerator } from "./image-generator";
import { FlowEditor } from "./flow-editor";
import { SandpackSandbox } from "./sandpack-sandbox";
import { FileConverter } from "./file-converter";
import { BlockEditor } from "./block-editor";
import { NovelEditor } from "./novel-editor";
import { TldrawCanvas } from './tldraw-canvas';
import { GraphViewer } from "./graph-viewer";
import { MantineToolkit } from "./mantine-toolkit";
import { UniverSheet } from "./univer-sheet";
import { TremorDashboard } from "./tremor-dashboard";

// --- Pill metadata per widget type ---

const textPill   = { icon: TypeIcon,              label: "Text",    accent: "text-amber-400",  bgAccent: "bg-amber-500/15"  };
const jsonPill   = { icon: BracesIcon,             label: "JSON",    accent: "text-green-400",  bgAccent: "bg-green-500/15"  };
const filePill   = { icon: FileIcon,               label: "File",    accent: "text-zinc-400",   bgAccent: "bg-zinc-500/15"   };
const imgPill    = { icon: ImageIcon,              label: "Image",   accent: "text-pink-400",   bgAccent: "bg-pink-500/15"   };
const mediaPill  = { icon: VideoIcon,              label: "Media",   accent: "text-sky-400",    bgAccent: "bg-sky-500/15"    };
const musicPill  = { icon: MusicIcon,              label: "Music",   accent: "text-purple-400", bgAccent: "bg-purple-500/15" };
const palettePill= { icon: PaletteIcon,            label: "Palette", accent: "text-rose-400",   bgAccent: "bg-rose-500/15"   };
const qrPill     = { icon: QrCodeIcon,             label: "QR Code", accent: "text-zinc-300",   bgAccent: "bg-zinc-500/15"   };
const jwtPill    = { icon: KeyRoundIcon,           label: "JWT",     accent: "text-yellow-400", bgAccent: "bg-yellow-500/15" };
const chartPill  = { icon: BarChart3Icon,          label: "Chart",   accent: "text-blue-400",   bgAccent: "bg-blue-500/15"   };
const codePill   = { icon: CodeIcon,               label: "Code",    accent: "text-emerald-400",bgAccent: "bg-emerald-500/15"};
const mdPill     = { icon: FileTextIcon,           label: "Markdown",accent: "text-orange-400", bgAccent: "bg-orange-500/15" };
const pdfPill    = { icon: ScrollTextIcon,          label: "PDF",     accent: "text-red-400",    bgAccent: "bg-red-500/15"    };
const diffPill   = { icon: GitCompareArrowsIcon,   label: "Diff",    accent: "text-amber-400",  bgAccent: "bg-amber-500/15"  };
const boardPill  = { icon: PenToolIcon,            label: "Board",   accent: "text-indigo-400", bgAccent: "bg-indigo-500/15" };
const timerPill  = { icon: TimerIcon,              label: "Timer",   accent: "text-teal-400",   bgAccent: "bg-teal-500/15"   };
const tablePill  = { icon: TableIcon,              label: "Table",   accent: "text-blue-400",   bgAccent: "bg-blue-500/15"   };
const mermaidPill    = { icon: GitForkIcon,    label: "Diagram",   accent: "text-cyan-400",  bgAccent: "bg-cyan-500/15"   };
const downloaderPill = { icon: DownloadIcon,  label: "Video",     accent: "text-rose-400",  bgAccent: "bg-rose-500/15"   };
const subtitlePill   = { icon: SubtitlesIcon, label: "Subtitles", accent: "text-cyan-400",  bgAccent: "bg-cyan-500/15"   };
const kanbanPill     = { icon: LayoutDashboardIcon, label: "Kanban",  accent: "text-indigo-400",  bgAccent: "bg-indigo-500/15"  };
const mindmapPill    = { icon: NetworkIcon,         label: "MindMap", accent: "text-violet-400",  bgAccent: "bg-violet-500/15"  };
const countdownPill  = { icon: HourglassIcon,       label: "Timer",   accent: "text-amber-400",   bgAccent: "bg-amber-500/15"   };
const habitsPill     = { icon: CalendarCheckIcon,    label: "Habits",  accent: "text-lime-400",    bgAccent: "bg-lime-500/15"    };
const flashcardPill  = { icon: LayersIcon,           label: "Cards",   accent: "text-fuchsia-400", bgAccent: "bg-fuchsia-500/15" };
const clockPill      = { icon: GlobeIcon,            label: "Clock",   accent: "text-sky-400",     bgAccent: "bg-sky-500/15"     };
const excalidrawPill = { icon: PencilRulerIcon,      label: "Draw",    accent: "text-violet-400",  bgAccent: "bg-violet-500/15"  };
const sheetPill      = { icon: Grid3X3Icon,          label: "Sheet",   accent: "text-teal-400",    bgAccent: "bg-teal-500/15"    };
const imageGenPill   = { icon: SparklesIcon,         label: "Image",   accent: "text-fuchsia-400", bgAccent: "bg-fuchsia-500/15" };
const flowPill       = { icon: WorkflowIcon,         label: "Flow",    accent: "text-cyan-400",    bgAccent: "bg-cyan-500/15"    };
const sandpackPill   = { icon: BoxIcon,              label: "Sandbox", accent: "text-green-400",   bgAccent: "bg-green-500/15"   };
const converterPill  = { icon: RefreshCwIcon,        label: "Convert", accent: "text-orange-400",  bgAccent: "bg-orange-500/15"  };
const blockPill      = { icon: LayoutListIcon,       label: "Editor",  accent: "text-blue-400",    bgAccent: "bg-blue-500/15"    };
const novelPill      = { icon: SparklesIcon,         label: "Writer",  accent: "text-amber-400",   bgAccent: "bg-amber-500/15"   };

const tldrawPill    = { icon: PenToolIcon,          label: 'Canvas',  accent: 'text-violet-400',  bgAccent: 'bg-violet-500/15'  };
const univerPill    = { icon: TableIcon,            label: "Sheet",   accent: "text-emerald-400", bgAccent: "bg-emerald-500/15" };
const tremorPill    = { icon: BarChart3Icon,        label: "Dashboard", accent: "text-indigo-400", bgAccent: "bg-indigo-500/15" };

// --- Registry entries ---
// Each builder wraps component with error boundary to isolate widget crashes.

const entry = (pill: WidgetEntry["pill"]) =>
  (component: ToolCallMessagePartComponent): WidgetEntry =>
    ({ component: withErrorBoundary(component), pill });

const text    = entry(textPill);
const json    = entry(jsonPill);
const file    = entry(filePill);
const img     = entry(imgPill);
const media   = entry(mediaPill);
const music   = entry(musicPill);
const palette = entry(palettePill);
const qr      = entry(qrPill);
const jwt     = entry(jwtPill);
const chart   = entry(chartPill);
const code    = entry(codePill);
const md      = entry(mdPill);
const pdf     = entry(pdfPill);
const diff    = entry(diffPill);
const board   = entry(boardPill);
const timer   = entry(timerPill);
const table   = entry(tablePill);
const mermaid    = entry(mermaidPill);
const downloader = entry(downloaderPill);
const subtitle   = entry(subtitlePill);
const kanban     = entry(kanbanPill);
const mindmapW   = entry(mindmapPill);
const countdownW = entry(countdownPill);
const habitsW    = entry(habitsPill);
const flashcardW = entry(flashcardPill);
const clockW     = entry(clockPill);
const excalidrawW= entry(excalidrawPill);
const sheetW     = entry(sheetPill);
const imageGenW  = entry(imageGenPill);
const flowW      = entry(flowPill);
const sandpackW  = entry(sandpackPill);
const converterW = entry(converterPill);
const blockW     = entry(blockPill);
const novelW     = entry(novelPill);

const tldrawW    = entry(tldrawPill);
const univerW    = entry(univerPill);
const tremorW    = entry(tremorPill);
const graphPill  = { icon: NetworkIcon, label: "Graph",   accent: "text-pink-400",  bgAccent: "bg-pink-500/15"  };
const toolkitPill= { icon: WrenchIcon,  label: "Toolkit", accent: "text-teal-400",  bgAccent: "bg-teal-500/15"  };
const graphW     = entry(graphPill);
const toolkitW   = entry(toolkitPill);

export const widgetRegistry: Record<string, WidgetEntry> = {
  // hash (4)
  hash_md5:              text(TextResult),
  hash_sha256:           text(TextResult),
  hash_sha512:           text(TextResult),
  hash_password:         text(TextResult),
  // encode (5)
  encode_base64:         text(TextResult),
  decode_base64:         text(TextResult),
  encode_url:            text(TextResult),
  decode_url:            text(TextResult),
  decode_jwt:            jwt(JwtViewer),
  // generate (5+)
  generate_uuid:         text(TextResult),
  generate_password:     text(TextResult),
  generate_timestamp:    json(JsonResult),
  generate_qrcode:       qr(QrCodeViewer),
  generate_color_palette:palette(ColorPalette),
  generate_chart:        chart(ChartBuilder),
  // convert (6)
  convert_json_yaml:     text(TextResult),
  convert_yaml_json:     text(TextResult),
  convert_json_csv:      table(TableResult),
  convert_csv_json:      table(TableResult),
  convert_json_format:   text(TextResult),
  convert_md_html:       md(MarkdownEditor),
  // net (3)
  net_dns_lookup:        json(JsonResult),
  net_ip_info:           json(JsonResult),
  net_music_search:      music(MusicPlayer),
  // pdf (5)
  pdf_compress:          pdf(PdfViewer),
  pdf_merge:             pdf(PdfViewer),
  pdf_split:             pdf(PdfViewer),
  pdf_to_image:          img(ImageStudio),
  pdf_page_count:        pdf(PdfViewer),
  // image (6)
  image_compress:        img(ImageStudio),
  image_resize:          img(ImageStudio),
  image_crop:            img(ImageStudio),
  image_convert:         img(ImageStudio),
  image_rotate:          img(ImageStudio),
  image_metadata:        json(JsonResult),
  image_upscale:         img(ImageStudio),
  image_remove_watermark: img(ImageStudio),
  image_remove_watermark_batch: file(FileResult),
  image_remove_background: img(ImageStudio),
  image_face_restore: img(ImageStudio),
  image_outpaint: img(ImageStudio),
  image_iopaint_studio: img(ImageStudio),
  // video (5)
  video_compress:        media(MediaPlayer),
  video_convert:         media(MediaPlayer),
  video_trim:            media(MediaPlayer),
  video_to_gif:          media(MediaPlayer),
  video_extract_audio:   media(MediaPlayer),
  // audio (4)
  audio_convert:         media(MediaPlayer),
  audio_trim:            media(MediaPlayer),
  audio_compress:        media(MediaPlayer),
  audio_normalize:       media(MediaPlayer),
  // dev tools
  dev_run_code:          code(CodePlayground),
  dev_diff:              diff(DiffViewer),
  // utility
  generate_whiteboard:   board(Whiteboard),
  generate_pomodoro:     timer(PomodoroTimer),
  // diagram
  generate_diagram:      mermaid(MermaidViewer),
  dev_diagram:           mermaid(MermaidViewer),
  // file
  file_compress:         file(FileResult),
  file_result:           file(FileResult),
  word_extract_text:     file(FileResult),
  // media download / subtitle
  media_video_info:      downloader(VideoDownloader),
  media_download_video:  downloader(VideoDownloader),
  media_download_audio:  downloader(VideoDownloader),
  media_extract_subtitle: subtitle(SubtitleViewer),
  // productivity (8)
  generate_kanban:       kanban(KanbanBoard),
  generate_mindmap:      mindmapW(MindMap),
  generate_countdown:    countdownW(CountdownTimer),
  generate_habits:       habitsW(HabitTracker),
  generate_flashcards:   flashcardW(FlashcardDeck),
  generate_worldclock:   clockW(WorldClock),
  generate_excalidraw:   excalidrawW(ExcalidrawBoard),
  generate_spreadsheet:  sheetW(SpreadsheetGrid),
  // ai image generation
  generate_image:        imageGenW(ImageGenerator),
  // flow editor
  generate_flow:         flowW(FlowEditor),
  flow_editor:           flowW(FlowEditor),
  // sandpack sandbox
  sandpack_sandbox:      sandpackW(SandpackSandbox),
  dev_sandbox:           sandpackW(SandpackSandbox),
  // file converter
  file_converter:        converterW(FileConverter),
  convert_file:          converterW(FileConverter),
  // block editor
  block_editor:          blockW(BlockEditor),
  generate_document:     blockW(BlockEditor),
  // novel writer
  novel_editor:          novelW(NovelEditor),
  generate_writing:      novelW(NovelEditor),
  // tldraw canvas
  generate_canvas:       tldrawW(TldrawCanvas),
  tldraw_canvas:         tldrawW(TldrawCanvas),
  // sigma graph viewer
  graph_viewer:          graphW(GraphViewer),
  generate_graph:        graphW(GraphViewer),
  // mantine toolkit
  mantine_toolkit:       toolkitW(MantineToolkit),
  generate_toolkit:      toolkitW(MantineToolkit),
  // univer excel-grade sheet
  univer_sheet:          univerW(UniverSheet),
  generate_univer:       univerW(UniverSheet),
  // tremor data dashboard
  tremor_dashboard:      tremorW(TremorDashboard),
  generate_dashboard:    tremorW(TremorDashboard),
};

/** Backward-compatible component map for thread.tsx */
export const toolWidgets: Record<string, ToolCallMessagePartComponent> =
  Object.fromEntries(Object.entries(widgetRegistry).map(([k, v]) => [k, v.component]));
