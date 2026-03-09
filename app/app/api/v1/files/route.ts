import { extname } from "node:path";
import { writeFileSync } from "node:fs";
import { artifactStore } from "@/lib/server/artifact-store";
import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { withObservedRequest } from "@/lib/server/observability";
import { register } from "@/lib/server/local-file-store";
import { tempFile } from "@/lib/tools/helpers";
import {
  enforceMultipartPayloadLimit,
  enforceWriteRateLimit,
  recordAuditEvent,
} from "@/lib/server/security-controls";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

type UploadedFilePayload = {
  name: string;
  size_bytes: number;
  content_type: string;
  executor_url?: string;
  url: string;
  artifact?: {
    bucket: string;
    content_type: string;
    expires_at: number;
    key: string;
    size_bytes: number;
    storage: "s3";
  };
};

const normalizeScope = (value: FormDataEntryValue | null): string => {
  if (typeof value !== "string") {
    return "user_input";
  }
  const normalized = value.trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return normalized || "user_input";
};

const extensionFromName = (fileName: string): string => {
  const raw = extname(fileName).replace(/^\./, "").trim().toLowerCase();
  return raw || "bin";
};

const extractFiles = (formData: FormData): File[] => {
  const entries: File[] = [];
  for (const value of formData.getAll("files")) {
    if (value instanceof File) {
      entries.push(value);
    }
  }
  const single = formData.get("file");
  if (single instanceof File) {
    entries.push(single);
  }
  return entries;
};

const badRequest = (code: string, message: string): Response => {
  return Response.json(
    {
      ok: false,
      error: {
        code,
        message,
      },
    },
    { status: 400 },
  );
};

export async function POST(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/files",
    handler: async (observation) => {
      const access = authorizeRequest(req, "execute:write");
      if (!access.ok) {
        return toResponse(access);
      }
      const identity = access.identity;
      observation.setIdentity(identity);

      const rateLimitResponse = enforceWriteRateLimit(
        identity,
        "/api/v1/files",
        observation.requestId,
      );
      if (rateLimitResponse) {
        return rateLimitResponse;
      }
      const multipartLimitResponse = enforceMultipartPayloadLimit(
        req,
        "/api/v1/files",
      );
      if (multipartLimitResponse) {
        return multipartLimitResponse;
      }

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        return badRequest(
          "invalid_multipart",
          "Expected multipart/form-data body.",
        );
      }

      const files = extractFiles(formData);
      if (files.length === 0) {
        return badRequest(
          "missing_file",
          "No file provided. Use field `file` or `files`.",
        );
      }

      let totalBytes = 0;
      for (const file of files) {
        if (file.size <= 0) {
          return badRequest(
            "empty_file",
            `Empty file is not allowed: ${file.name}`,
          );
        }
        if (file.size > MAX_FILE_BYTES) {
          return badRequest(
            "file_too_large",
            `File too large: ${file.name} (${file.size} bytes > ${MAX_FILE_BYTES} bytes).`,
          );
        }
        totalBytes += file.size;
      }

      if (totalBytes > MAX_TOTAL_BYTES) {
        return badRequest(
          "payload_too_large",
          `Total upload size exceeds ${MAX_TOTAL_BYTES} bytes.`,
        );
      }

      const scope = normalizeScope(formData.get("scope"));
      const uploaded: UploadedFilePayload[] = [];

      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const contentType = file.type || "application/octet-stream";
        let persisted: Awaited<ReturnType<typeof artifactStore.persist>>;
        try {
          persisted = await artifactStore.persist({
            body: bytes,
            contentType,
            extension: extensionFromName(file.name),
            toolId: `upload.${scope}`,
          });
        } catch {
          persisted = undefined;
        }

        if (!persisted) {
          try {
            const tmpPath = tempFile(extensionFromName(file.name));
            writeFileSync(tmpPath, bytes);
            const localUrl = register(tmpPath, file.name);
            const origin = new URL(req.url).origin;
            uploaded.push({
              name: file.name,
              size_bytes: file.size,
              content_type: contentType,
              executor_url: origin + localUrl,
              url: localUrl,
            });
          } catch {
            return Response.json(
              {
                ok: false,
                error: {
                  code: "file_store_error",
                  message: `Failed to persist upload: ${file.name}`,
                },
              },
              { status: 500 },
            );
          }
          continue;
        }

        uploaded.push({
          name: file.name,
          size_bytes: file.size,
          content_type: contentType,
          executor_url: persisted.internalUrl,
          url: persisted.url,
          artifact: {
            bucket: persisted.bucket,
            content_type: persisted.contentType,
            expires_at: persisted.expiresAt,
            key: persisted.key,
            size_bytes: persisted.sizeBytes,
            storage: persisted.storage,
          },
        });
      }

      recordAuditEvent({
        action: "execution.upload_completed",
        apiKeyId: identity.apiKeyId,
        details: {
          count: uploaded.length,
          scope,
          total_bytes: totalBytes,
        },
        method: "POST",
        outcome: "allowed",
        requestId: observation.requestId,
        route: "/api/v1/files",
        tenantId: identity.tenantId,
      });

      return Response.json({
        ok: true,
        count: uploaded.length,
        files: uploaded,
      });
    },
  });
}
