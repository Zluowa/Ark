// @input: All tool category modules
// @output: Unified allTools array and individual named exports
// @position: Single entry point for tool registration by API layer

export { pdfCompress, pdfMerge, pdfSplit, pdfToImage, pdfPageCount } from "./pdf";
export {
  imageCompress,
  imageResize,
  imageCrop,
  imageConvert,
  imageRotate,
  imageMetadata,
} from "./image";
export {
  imageUpscale,
  imageRemoveWatermark,
  imageRemoveWatermarkBatch,
  imageRemoveObject,
  imageReplaceObject,
  imageAddText,
  imageRemoveBackground,
  imageFaceRestore,
  imageOutpaint,
  imageIOPaintStudio,
} from "./image-ai";
export { videoCompress, videoConvert, videoTrim, videoToGif, videoExtractAudio } from "./video";
export { audioConvert, audioTrim, audioCompress, audioNormalize } from "./audio";
export { audioTranscribeText, audioTranscribeSummary, videoAnalyzeSummary } from "./capture-ai";
export { fileCompress } from "./file";
export { wordExtractText } from "./word";
export { textProcess } from "./text-ai";
export { jsonToYaml, yamlToJson, jsonToCsv, csvToJson, jsonFormat, mdToHtml } from "./convert";
export { base64Encode, base64Decode, urlEncode, urlDecode, jwtDecode } from "./encode";
export { md5Hash, sha256Hash, sha512Hash, bcryptHash } from "./hash";
export { generateUuid, generatePassword, generateTimestamp, generateQrcode, generateColorPalette } from "./generate";
export { dnsLookup, ipInfo, musicSearch, webSearch } from "./net";
export { mediaVideoInfo, mediaDownloadVideo, mediaDownloadAudio, mediaExtractSubtitle } from "./media-download";
export {
  generateKanban, generateMindmap, generateCountdown, generateHabits,
  generateFlashcards, generateWorldclock, generateExcalidraw, generateSpreadsheet,
} from "./productivity";
export { generateImage } from "./image-gen";
export {
  generateWhiteboard, generatePomodoro, generateChart, generateDiagram,
  generateFlow, generateCanvas, generateDocument, generateWriting,
  generateGraph, generateToolkit, generateUniver, generateDashboard,
  devRunCode, devDiff, devSandbox,
} from "./interactive";

import { pdfCompress, pdfMerge, pdfSplit, pdfToImage, pdfPageCount } from "./pdf";
import {
  imageCompress,
  imageResize,
  imageCrop,
  imageConvert,
  imageRotate,
  imageMetadata,
} from "./image";
import {
  imageUpscale,
  imageRemoveWatermark,
  imageRemoveWatermarkBatch,
  imageRemoveObject,
  imageReplaceObject,
  imageAddText,
  imageRemoveBackground,
  imageFaceRestore,
  imageOutpaint,
  imageIOPaintStudio,
} from "./image-ai";
import { videoCompress, videoConvert, videoTrim, videoToGif, videoExtractAudio } from "./video";
import { audioConvert, audioTrim, audioCompress, audioNormalize } from "./audio";
import { audioTranscribeText, audioTranscribeSummary, videoAnalyzeSummary } from "./capture-ai";
import { fileCompress } from "./file";
import { wordExtractText } from "./word";
import { textProcess } from "./text-ai";
import { jsonToYaml, yamlToJson, jsonToCsv, csvToJson, jsonFormat, mdToHtml } from "./convert";
import { base64Encode, base64Decode, urlEncode, urlDecode, jwtDecode } from "./encode";
import { md5Hash, sha256Hash, sha512Hash, bcryptHash } from "./hash";
import { generateUuid, generatePassword, generateTimestamp, generateQrcode, generateColorPalette } from "./generate";
import { dnsLookup, ipInfo, musicSearch, webSearch } from "./net";
import { mediaVideoInfo, mediaDownloadVideo, mediaDownloadAudio, mediaExtractSubtitle } from "./media-download";
import {
  generateKanban, generateMindmap, generateCountdown, generateHabits,
  generateFlashcards, generateWorldclock, generateExcalidraw, generateSpreadsheet,
} from "./productivity";
import { generateImage } from "./image-gen";
import {
  generateWhiteboard, generatePomodoro, generateChart, generateDiagram,
  generateFlow, generateCanvas, generateDocument, generateWriting,
  generateGraph, generateToolkit, generateUniver, generateDashboard,
  devRunCode, devDiff, devSandbox,
} from "./interactive";
import type { ToolRegistryEntry } from "@/lib/engine/types";

export const allTools: ToolRegistryEntry[] = [
  pdfCompress, pdfMerge, pdfSplit, pdfToImage, pdfPageCount,
  imageCompress, imageResize, imageCrop, imageConvert, imageRotate, imageMetadata,
  imageUpscale, imageRemoveWatermark, imageRemoveWatermarkBatch,
  imageRemoveObject, imageReplaceObject, imageAddText,
  imageRemoveBackground, imageFaceRestore, imageOutpaint, imageIOPaintStudio,
  videoCompress, videoConvert, videoTrim, videoToGif, videoExtractAudio,
  audioConvert, audioTrim, audioCompress, audioNormalize,
  audioTranscribeText, audioTranscribeSummary, videoAnalyzeSummary,
  fileCompress,
  wordExtractText,
  textProcess,
  jsonToYaml, yamlToJson, jsonToCsv, csvToJson, jsonFormat, mdToHtml,
  base64Encode, base64Decode, urlEncode, urlDecode, jwtDecode,
  md5Hash, sha256Hash, sha512Hash, bcryptHash,
  generateUuid, generatePassword, generateTimestamp, generateQrcode, generateColorPalette,
  dnsLookup, ipInfo, musicSearch, webSearch,
  mediaVideoInfo, mediaDownloadVideo, mediaDownloadAudio, mediaExtractSubtitle,
  generateKanban, generateMindmap, generateCountdown, generateHabits,
  generateFlashcards, generateWorldclock, generateExcalidraw, generateSpreadsheet,
  generateImage,
  generateWhiteboard, generatePomodoro, generateChart, generateDiagram,
  generateFlow, generateCanvas, generateDocument, generateWriting,
  generateGraph, generateToolkit, generateUniver, generateDashboard,
  devRunCode, devDiff, devSandbox,
];
