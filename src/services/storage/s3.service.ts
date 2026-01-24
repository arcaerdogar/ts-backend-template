import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "../aws/aws.config.js";
import { env } from "../../config/env.js";
import type { IStorageService } from "./storage.interface.js";

export class S3Service implements IStorageService {
  private bucket = env.aws.s3.bucket;
  private cdnDomain = env.aws.s3.cdnDomain;

  async getPresignedUploadUrl(
    prefix: string,
    key: string,
    contentType: string,
    size: number,
    checksumSHA256: string,
  ): Promise<{ url: string; key: string }> {
    const fullKey = `${prefix}/${key}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fullKey,
      ContentType: contentType,
      // ChecksumAlgorithm: "SHA256",
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 minutes

    return { url, key: fullKey };
  }

  getPublicUrl(key: string): string {
    if (this.cdnDomain) {
      return `https://${this.cdnDomain}/${key}`;
    }
    return `https://${this.bucket}.s3.${env.aws.region}.amazonaws.com/${key}`;
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await s3Client.send(command);
  }

  async checkExists(
    key: string,
  ): Promise<{ size: number; mimeType: string; etag: string }> {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await s3Client.send(command);

    return {
      size: response.ContentLength || 0,
      mimeType: response.ContentType || "application/octet-stream",
      etag: response.ETag?.replace(/"/g, "") || "", // Remove quotes from ETag
    };
  }

  async move(sourceKey: string, destinationKey: string): Promise<void> {
    const { CopyObjectCommand, DeleteObjectCommand } =
      await import("@aws-sdk/client-s3");

    // 1. Copy
    const copyCommand = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${sourceKey}`,
      Key: destinationKey,
    });
    await s3Client.send(copyCommand);

    // 2. Delete Source
    const deleteCommand = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: sourceKey,
    });
    await s3Client.send(deleteCommand);
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
  }
}

export const storageService = new S3Service();
