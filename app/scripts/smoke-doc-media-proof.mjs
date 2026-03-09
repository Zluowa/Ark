import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";
const outDir =
  process.env.OMNIAGENT_DOC_MEDIA_OUTDIR?.trim() ||
  path.join(repoRoot, "test-screenshots", "2026-03-06-doc-media-proof");
const fixtureDir = path.join(repoRoot, "test-fixtures", "window-upload-proof");
const mediaUrl =
  process.env.OMNIAGENT_MEDIA_TEST_URL?.trim() ||
  "https://www.bilibili.com/video/BV1m34y1F7fD/";

const ensureOk = async (res, label) => {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 800)}`);
};

const absUrl = (url) =>
  /^https?:\/\//i.test(url) ? url : `${appBaseUrl}${url}`;

const downloadToFile = async (url, targetPath) => {
  const res = await fetch(absUrl(url), { headers: withAuthHeaders() });
  await ensureOk(res, `GET ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(targetPath, buf);
  return { path: targetPath, size: buf.length };
};

const uploadFile = async (localPath, scope = "doc_media_proof") => {
  const binary = await readFile(localPath);
  const blob = new Blob([binary]);
  const form = new FormData();
  form.append("files", blob, path.basename(localPath));
  form.append("scope", scope);

  const res = await fetch(`${appBaseUrl}/api/v1/files`, {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
  });
  await ensureOk(res, `upload ${path.basename(localPath)}`);
  const body = await res.json();
  const first = Array.isArray(body?.files) ? body.files[0] : undefined;
  const url =
    typeof first?.executor_url === "string" && first.executor_url.trim()
      ? first.executor_url.trim()
      : typeof first?.url === "string" && first.url.trim()
        ? first.url.trim()
        : "";
  if (!url) {
    throw new Error(`upload missing file url for ${localPath}`);
  }
  return url;
};

const execute = async (tool, params) => {
  const res = await fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ tool, params }),
  });
  await ensureOk(res, `execute ${tool}`);
  const body = await res.json();
  if (body?.status !== "success") {
    throw new Error(`tool ${tool} did not succeed: ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body;
};

const requireText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} missing non-empty text`);
  }
  return value;
};

const requireNumber = (value, label) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} missing numeric value`);
  }
  return value;
};

const main = async () => {
  console.log(`[doc-media-proof] app=${appBaseUrl} ${authHint}`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const tempFixtureDir = path.join(outDir, "_fixtures");
  await mkdir(tempFixtureDir, { recursive: true });

  const samplePdf = path.join(fixtureDir, "sample.pdf");
  const sampleDocx = path.join(fixtureDir, "sample.docx");

  const jsonPath = path.join(tempFixtureDir, "sample.json");
  const yamlPath = path.join(tempFixtureDir, "sample.yaml");
  const csvPath = path.join(tempFixtureDir, "sample.csv");
  const mdPath = path.join(tempFixtureDir, "sample.md");

  await writeFile(jsonPath, JSON.stringify([{ name: "omni", kind: "agent" }], null, 2));
  await writeFile(yamlPath, "name: omni\nkind: agent\n");
  await writeFile(csvPath, "name,kind\nomni,agent\n");
  await writeFile(mdPath, "# OmniAgent\n\n**Dynamic island** proof.\n");

  const pdfUrl = await uploadFile(samplePdf);
  const docxUrl = await uploadFile(sampleDocx);

  const report = {
    generatedAt: new Date().toISOString(),
    appBaseUrl,
    mediaUrl,
    uploads: { pdfUrl, docxUrl },
    results: {},
  };

  const pdfCompress = await execute("pdf.compress", {
    file_url: pdfUrl,
    quality: 75,
  });
  report.results.pdf_compress = {
    response: pdfCompress,
    downloaded: await downloadToFile(
      requireText(pdfCompress?.result?.output_file_url, "pdf.compress output_file_url"),
      path.join(outDir, "pdf-compress-output.pdf"),
    ),
  };

  const pdfPageCount = await execute("pdf.page_count", { file_url: pdfUrl });
  report.results.pdf_page_count = { response: pdfPageCount };
  requireNumber(
    Object.values(pdfPageCount?.result || {}).find((v) => typeof v === "number"),
    "pdf.page_count numeric output",
  );

  const pdfSplit = await execute("pdf.split", {
    file_url: pdfUrl,
    ranges: "1-1",
  });
  report.results.pdf_split = {
    response: pdfSplit,
    downloaded: await downloadToFile(
      requireText(pdfSplit?.result?.output_file_url, "pdf.split output_file_url"),
      path.join(outDir, "pdf-split-output.pdf"),
    ),
  };

  const pdfToImage = await execute("pdf.to_image", {
    file_url: pdfUrl,
    page: 1,
    dpi: 150,
  });
  report.results.pdf_to_image = {
    response: pdfToImage,
    downloaded: await downloadToFile(
      requireText(pdfToImage?.result?.output_file_url, "pdf.to_image output_file_url"),
      path.join(outDir, "pdf-to-image-output.png"),
    ),
  };

  const pdfMerge = await execute("pdf.merge", {
    file_urls: `${pdfUrl},${pdfUrl}`,
  });
  report.results.pdf_merge = {
    response: pdfMerge,
    downloaded: await downloadToFile(
      requireText(pdfMerge?.result?.output_file_url, "pdf.merge output_file_url"),
      path.join(outDir, "pdf-merge-output.pdf"),
    ),
  };

  const wordExtract = await execute("word.extract_text", { file_url: docxUrl });
  report.results.word_extract_text = {
    response: wordExtract,
    downloaded: await downloadToFile(
      requireText(wordExtract?.result?.output_file_url, "word.extract_text output_file_url"),
      path.join(outDir, "word-extract-output.txt"),
    ),
  };
  requireText(wordExtract?.result?.text, "word.extract_text text");

  const jsonYaml = await execute("convert.json_yaml", {
    input: await readFile(jsonPath, "utf8"),
  });
  report.results.convert_json_yaml = {
    response: jsonYaml,
    saved: path.join(outDir, "convert-json-yaml.yaml"),
  };
  await writeFile(report.results.convert_json_yaml.saved, requireText(jsonYaml?.result?.text, "convert.json_yaml text"));

  const yamlJson = await execute("convert.yaml_json", {
    input: await readFile(yamlPath, "utf8"),
  });
  report.results.convert_yaml_json = {
    response: yamlJson,
    saved: path.join(outDir, "convert-yaml-json.json"),
  };
  await writeFile(report.results.convert_yaml_json.saved, requireText(yamlJson?.result?.text, "convert.yaml_json text"));

  const jsonCsv = await execute("convert.json_csv", {
    input: await readFile(jsonPath, "utf8"),
  });
  report.results.convert_json_csv = {
    response: jsonCsv,
    saved: path.join(outDir, "convert-json-csv.csv"),
  };
  await writeFile(report.results.convert_json_csv.saved, requireText(jsonCsv?.result?.text, "convert.json_csv text"));

  const csvJson = await execute("convert.csv_json", {
    input: await readFile(csvPath, "utf8"),
  });
  report.results.convert_csv_json = {
    response: csvJson,
    saved: path.join(outDir, "convert-csv-json.json"),
  };
  await writeFile(report.results.convert_csv_json.saved, requireText(csvJson?.result?.text, "convert.csv_json text"));

  const jsonFormat = await execute("convert.json_format", {
    input: JSON.stringify({ name: "omni", features: ["docs", "video"] }),
    mode: "pretty",
  });
  report.results.convert_json_format = {
    response: jsonFormat,
    saved: path.join(outDir, "convert-json-format.json"),
  };
  await writeFile(report.results.convert_json_format.saved, requireText(jsonFormat?.result?.text, "convert.json_format text"));

  const mdHtml = await execute("convert.md_html", {
    input: await readFile(mdPath, "utf8"),
  });
  report.results.convert_md_html = {
    response: mdHtml,
    saved: path.join(outDir, "convert-md-html.html"),
  };
  await writeFile(report.results.convert_md_html.saved, requireText(mdHtml?.result?.text, "convert.md_html text"));

  const mediaInfo = await execute("media.video_info", { url: mediaUrl });
  report.results.media_video_info = { response: mediaInfo };
  requireText(mediaInfo?.result?.platform, "media.video_info platform");
  requireText(mediaInfo?.result?.duration_str, "media.video_info duration_str");

  const mediaDownload = await execute("media.download_video", { url: mediaUrl });
  report.results.media_download_video = {
    response: mediaDownload,
    downloaded: await downloadToFile(
      requireText(mediaDownload?.result?.output_file_url, "media.download_video output_file_url"),
      path.join(outDir, "media-download-video.mp4"),
    ),
  };

  for (const [key, value] of Object.entries(report.results)) {
    if (value?.downloaded?.path) {
      const info = await stat(value.downloaded.path);
      value.downloaded.size = info.size;
    }
  }

  const reportPath = path.join(outDir, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`[doc-media-proof] PASS -> ${reportPath}`);
};

main().catch((error) => {
  console.error(
    "[doc-media-proof] FAIL",
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exit(1);
});
