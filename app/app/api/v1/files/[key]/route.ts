// @input: UUID key in URL path → local-file-store lookup
// @output: Streamed file bytes with Content-Disposition for download
// @position: HTTP serve layer for noop-mode tool-produced files

import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { resolve } from "@/lib/server/local-file-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { key } = await context.params;
  const entry = resolve(key);
  if (!entry) {
    return Response.json({ error: "not_found", hint: "File may have expired" }, { status: 404 });
  }
  try {
    const stat = statSync(entry.path);
    const stream = Readable.toWeb(createReadStream(entry.path)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": entry.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
        "Content-Length": String(stat.size),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return Response.json({ error: "file_unavailable" }, { status: 410 });
  }
}
