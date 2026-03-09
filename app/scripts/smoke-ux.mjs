import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";

const ensureOk = async (res, label) => {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 600)}`);
};

const main = async () => {
  console.log(`[ux-smoke] app=${appBaseUrl} ${authHint}`);

  const binary = Buffer.from(PNG_BASE64, "base64");
  const blob = new Blob([binary], { type: "image/png" });
  const formData = new FormData();
  formData.append("files", blob, "ux-sample.png");
  formData.append("scope", "smoke_ux");

  const uploadRes = await fetch(`${appBaseUrl}/api/v1/files`, {
    method: "POST",
    headers: withAuthHeaders(),
    body: formData,
  });
  await ensureOk(uploadRes, "POST /api/v1/files");
  const uploadBody = await uploadRes.json();
  const uploadedFile = Array.isArray(uploadBody?.files)
    ? uploadBody.files[0]
    : undefined;
  const inputUrlRaw =
    typeof uploadedFile?.executor_url === "string" &&
    uploadedFile.executor_url.trim()
      ? uploadedFile.executor_url.trim()
      : typeof uploadedFile?.url === "string"
        ? uploadedFile.url.trim()
        : "";
  const inputUrl = inputUrlRaw;
  if (!inputUrl) {
    throw new Error("Upload response missing file url.");
  }
  console.log("[ux-smoke] upload -> ok");

  const execRes = await fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      tool: "official.image.convert",
      params: {
        file: inputUrl,
        target_format: "webp",
      },
    }),
  });
  await ensureOk(execRes, "POST /api/v1/execute image.convert");
  const execBody = await execRes.json();
  if (
    execBody?.status !== "success" ||
    typeof execBody?.result?.output_file_url !== "string"
  ) {
    throw new Error("Expected success with output_file_url after upload.");
  }
  console.log("[ux-smoke] upload->execute -> ok");

  const badInputRes = await fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      tool: "official.image.convert",
      params: {
        file: "__definitely_missing__/not-found.png",
        target_format: "webp",
      },
    }),
  });
  if (badInputRes.ok) {
    const body = await badInputRes.text();
    throw new Error(`Invalid file input should fail, got success: ${body}`);
  }
  const badInputBody = await badInputRes.json();
  if (
    badInputBody?.status !== "failed" ||
    typeof badInputBody?.error?.code !== "string"
  ) {
    throw new Error("Invalid input failure payload is malformed.");
  }
  console.log(`[ux-smoke] invalid-input -> ${badInputBody.error.code}`);

  console.log("[ux-smoke] PASS");
};

main().catch((error) => {
  console.error(
    "[ux-smoke] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
