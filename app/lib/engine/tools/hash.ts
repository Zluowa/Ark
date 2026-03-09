// @input: params.text + params.algorithm (md5|sha1|sha256|sha512)
// @output: ExecuteResult with hex digest
// @position: Hashing tool — sample for v5 engine

import { createHash } from "node:crypto";
import type { ToolManifest, ToolHandler } from "../types";

const ALGORITHMS = ["md5", "sha1", "sha256", "sha512"] as const;
type Algorithm = (typeof ALGORITHMS)[number];

export const manifest: ToolManifest = {
  id: "util.hash",
  name: "Text Hasher",
  description: "Computes a cryptographic hash of the provided text.",
  category: "hash",
  tags: ["hash", "crypto", "md5", "sha256", "digest"],
  params: [
    {
      name: "text",
      type: "string",
      required: true,
      description: "The text to hash",
    },
    {
      name: "algorithm",
      type: "enum",
      required: false,
      default: "sha256",
      description: "Hash algorithm to use",
      enum_values: [...ALGORITHMS],
    },
  ],
  output_type: "json",
  keywords: ["hash", "md5", "sha256", "sha1", "sha512", "digest", "checksum"],
  patterns: ["hash\\s+.+", "md5|sha256|sha1|sha512", "checksum"],
};

export const handler: ToolHandler = async (params) => {
  const text = String(params.text ?? "");
  const raw = String(params.algorithm ?? "sha256").toLowerCase();
  const algorithm: Algorithm = ALGORITHMS.includes(raw as Algorithm)
    ? (raw as Algorithm)
    : "sha256";

  const digest = createHash(algorithm).update(text, "utf8").digest("hex");

  return {
    status: "success",
    output: { algorithm, digest, input_length: text.length },
    duration_ms: 1,
  };
};
