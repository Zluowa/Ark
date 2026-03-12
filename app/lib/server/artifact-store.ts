import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "@/lib/server/env";

export type PersistedArtifact = {
  bucket: string;
  contentType: string;
  expiresAt: number;
  internalUrl?: string;
  key: string;
  sizeBytes: number;
  storage: "s3";
  url: string;
};

export type ArtifactDownload = {
  body: unknown;
  contentLength?: number;
  contentType: string;
  filename: string;
};

type PersistArtifactInput = {
  body: string | Uint8Array;
  contentType: string;
  extension: string;
  toolId: string;
};

type ArtifactStoreBackend = {
  getDownload: (key: string) => Promise<ArtifactDownload | undefined>;
  persist: (
    input: PersistArtifactInput,
  ) => Promise<PersistedArtifact | undefined>;
};

const toBuffer = (body: string | Uint8Array): Buffer => {
  if (typeof body === "string") {
    return Buffer.from(body, "utf8");
  }
  return Buffer.from(body);
};

const safeSegment = (value: string): string => {
  const cleaned = value.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return cleaned || "artifact";
};

const safeExtension = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/^\.+/, "");
  const cleaned = normalized.replace(/[^a-z0-9]/g, "");
  return cleaned || "bin";
};

const isoDate = (): string => new Date().toISOString().slice(0, 10);

const asErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { name?: unknown; Code?: unknown }).name;
  if (typeof code === "string" && code.trim()) {
    return code;
  }
  const alt = (error as { Code?: unknown }).Code;
  if (typeof alt === "string" && alt.trim()) {
    return alt;
  }
  return undefined;
};

const asHttpStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const raw = (
    error as {
      $metadata?: {
        httpStatusCode?: unknown;
      };
    }
  ).$metadata?.httpStatusCode;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  return undefined;
};

const isMissingBucketError = (error: unknown): boolean => {
  const code = asErrorCode(error);
  if (
    code === "NotFound" ||
    code === "NoSuchBucket" ||
    code === "404" ||
    code === "NoSuchKey"
  ) {
    return true;
  }
  return asHttpStatus(error) === 404;
};

const isAlreadyExistsError = (error: unknown): boolean => {
  const code = asErrorCode(error);
  return code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists";
};

const filenameFromKey = (key: string): string => {
  const value = basename(key).trim();
  return value || "artifact.bin";
};

export const encodeArtifactToken = (key: string): string =>
  Buffer.from(key, "utf8").toString("base64url");

export const decodeArtifactToken = (token: string): string | undefined => {
  const normalized = token.trim();
  if (!normalized) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(normalized, "base64url")
      .toString("utf8")
      .trim();
    if (decoded) {
      return decoded;
    }
  } catch {
    // fall through to raw token handling
  }

  return normalized;
};

class NoopArtifactStore implements ArtifactStoreBackend {
  async persist(_input: PersistArtifactInput): Promise<undefined> {
    return undefined;
  }

  async getDownload(_key: string): Promise<undefined> {
    return undefined;
  }
}

class S3ArtifactStore implements ArtifactStoreBackend {
  private readonly bucket: string;
  private bucketReady?: Promise<void>;
  private readonly client: S3Client;
  private readonly internalSignClient?: S3Client;
  private readonly signedUrlTtlSec: number;

  constructor(config: {
    accessKey: string;
    bucket: string;
    endpoint: string;
    internalEndpoint?: string;
    region: string;
    secretKey: string;
    signedUrlTtlSec: number;
  }) {
    this.bucket = config.bucket;
    this.signedUrlTtlSec = Math.max(1, Math.floor(config.signedUrlTtlSec));
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: config.region,
    });
    if (config.internalEndpoint?.trim()) {
      this.internalSignClient = new S3Client({
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
        endpoint: config.internalEndpoint,
        forcePathStyle: true,
        region: config.region,
      });
    }
  }

  async persist(input: PersistArtifactInput): Promise<PersistedArtifact> {
    await this.ensureBucket();

    const extension = safeExtension(input.extension);
    const safeToolId = safeSegment(input.toolId);
    const key = `tools/${safeToolId}/${isoDate()}/${Date.now()}-${randomUUID()}.${extension}`;
    const body = toBuffer(input.body);

    await this.client.send(
      new PutObjectCommand({
        Body: body,
        Bucket: this.bucket,
        ContentType: input.contentType,
        Key: key,
        Metadata: {
          generated_by: "omniagent",
          tool_id: safeToolId,
        },
      }),
    );

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: this.signedUrlTtlSec },
    );

    const internalUrl = this.internalSignClient
      ? await getSignedUrl(
          this.internalSignClient,
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
          }),
          { expiresIn: this.signedUrlTtlSec },
        )
      : undefined;

    return {
      bucket: this.bucket,
      contentType: input.contentType,
      expiresAt: Date.now() + this.signedUrlTtlSec * 1000,
      internalUrl,
      key,
      sizeBytes: body.byteLength,
      storage: "s3",
      url,
    };
  }

  async getDownload(key: string): Promise<ArtifactDownload | undefined> {
    await this.ensureBucket();

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      if (!response.Body) {
        return undefined;
      }
      return {
        body: response.Body,
        contentLength:
          typeof response.ContentLength === "number"
            ? response.ContentLength
            : undefined,
        contentType: response.ContentType || "application/octet-stream",
        filename: filenameFromKey(key),
      };
    } catch (error) {
      if (isMissingBucketError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        try {
          await this.client.send(
            new HeadBucketCommand({ Bucket: this.bucket }),
          );
          return;
        } catch (error) {
          if (!isMissingBucketError(error)) {
            throw error;
          }
        }

        try {
          await this.client.send(
            new CreateBucketCommand({ Bucket: this.bucket }),
          );
        } catch (error) {
          if (!isAlreadyExistsError(error)) {
            throw error;
          }
        }
      })().catch((error) => {
        this.bucketReady = undefined;
        throw error;
      });
    }

    await this.bucketReady;
  }
}

const createArtifactStore = (): ArtifactStoreBackend => {
  const env = getServerEnv();
  if (
    env.artifactStore === "s3" &&
    env.s3Endpoint &&
    env.s3Bucket &&
    env.s3AccessKey &&
    env.s3SecretKey
  ) {
    return new S3ArtifactStore({
      accessKey: env.s3AccessKey,
      bucket: env.s3Bucket,
      endpoint: env.s3Endpoint,
      internalEndpoint: env.s3InternalEndpoint,
      region: env.s3Region,
      secretKey: env.s3SecretKey,
      signedUrlTtlSec: env.s3SignedUrlTtlSec,
    });
  }
  return new NoopArtifactStore();
};

export const artifactStore = createArtifactStore();
