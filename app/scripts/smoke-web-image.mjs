import { withAuthHeaders, authHint } from "./_auth-headers.mjs";

const appBaseUrl = process.env.OMNIAGENT_APP_BASE_URL?.trim() || "http://127.0.0.1:3010";

const ensureOk = async (response, label) => {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`${label} failed: ${response.status} ${text.slice(0, 600)}`);
};

const executeTool = async (tool, params) => {
  const response = await fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ tool, params }),
  });
  await ensureOk(response, `execute ${tool}`);
  const payload = await response.json();
  if (payload?.status !== "success") {
    throw new Error(`Tool ${tool} did not return success: ${JSON.stringify(payload)}`);
  }
  return payload;
};

const verifyDownload = async (url, label) => {
  const absolute = url.startsWith("http")
    ? url
    : `${appBaseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  const response = await fetch(absolute, { headers: withAuthHeaders() });
  await ensureOk(response, `${label} download`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 128) {
    throw new Error(`${label} output too small: ${bytes.byteLength} bytes`);
  }
  return bytes.byteLength;
};

async function main() {
  console.log(`[web-image-smoke] app=${appBaseUrl} ${authHint}`);

  const web = await executeTool("web.search", {
    query: "OpenAI latest developer updates",
    max_results: 3,
    include_answer: true,
  });
  const webResults = web?.result?.results;
  if (!Array.isArray(webResults) || webResults.length === 0) {
    throw new Error("web.search returned no results");
  }
  console.log(`[web-image-smoke] web.search -> ${webResults.length} results`);

  const image = await executeTool("generate.image", {
    prompt: "A simple red apple icon on white background",
    model: "gemini-3.1-flash-image-preview",
    aspect_ratio: "1:1",
    resolution: "1K",
  });
  const imageUrl = image?.result?.output_file_url;
  if (typeof imageUrl !== "string" || !imageUrl.trim()) {
    throw new Error(`generate.image missing output_file_url: ${JSON.stringify(image)}`);
  }
  const size = await verifyDownload(imageUrl, "generate.image");
  console.log(`[web-image-smoke] generate.image -> ${size} bytes`);
  console.log("[web-image-smoke] PASS");
}

main().catch((error) => {
  console.error("[web-image-smoke] FAIL", error?.message || error);
  process.exitCode = 1;
});
