// @input: File buffer + filename from callers
// @output: Signed URL after upload to R2/S3
// @position: File storage helper for engine tool handlers

import { randomUUID } from "node:crypto";
import {
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const getS3Config = () => ({
  endpoint: process.env.S3_ENDPOINT?.trim() || "http://localhost:39000",
  bucket: process.env.S3_BUCKET?.trim() || "omniagent",
  accessKey: process.env.S3_ACCESS_KEY?.trim() || "minioadmin",
  secretKey: process.env.S3_SECRET_KEY?.trim() || "minioadmin",
  region: process.env.S3_REGION?.trim() || "us-east-1",
});

const createClient = (config: ReturnType<typeof getS3Config>): S3Client =>
  new S3Client({
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    region: config.region,
    forcePathStyle: true,
  });

export const uploadToR2 = async (
  buffer: Buffer,
  filename: string,
): Promise<string> => {
  const config = getS3Config();
  const client = createClient(config);
  const ext = filename.split(".").pop() || "bin";
  const key = `uploads/${randomUUID()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: resolveContentType(ext),
    }),
  );

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: 3600 },
  );

  return url;
};

const resolveContentType = (ext: string): string => {
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    json: "application/json",
    zip: "application/zip",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
};
