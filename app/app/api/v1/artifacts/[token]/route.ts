import { Readable } from "node:stream";
import {
  artifactStore,
  decodeArtifactToken,
} from "@/lib/server/artifact-store";
import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ token: string }>;
};

const toWebStream = (body: unknown): ReadableStream => {
  if (
    body &&
    typeof body === "object" &&
    "transformToWebStream" in body &&
    typeof (body as { transformToWebStream?: unknown }).transformToWebStream ===
      "function"
  ) {
    return (
      body as {
        transformToWebStream: () => ReadableStream;
      }
    ).transformToWebStream();
  }
  return Readable.toWeb(body as Readable) as ReadableStream;
};

export async function GET(req: Request, context: RouteContext) {
  const access = authorizeRequest(req, "execute:read");
  if (!access.ok) {
    return toResponse(access);
  }

  const { token } = await context.params;
  const key = decodeArtifactToken(token);
  if (!key) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid_artifact",
          message: "Artifact token is invalid.",
        },
      },
      { status: 400 },
    );
  }

  const artifact = await artifactStore.getDownload(key);
  if (!artifact) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "artifact_not_found",
          message: "Artifact is missing or has expired.",
        },
      },
      { status: 404 },
    );
  }

  return new Response(toWebStream(artifact.body), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        artifact.filename,
      )}`,
      "Content-Type": artifact.contentType,
      ...(artifact.contentLength
        ? { "Content-Length": String(artifact.contentLength) }
        : {}),
    },
  });
}
