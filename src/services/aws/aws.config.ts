import { SESClient } from "@aws-sdk/client-ses";
import { S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";

const baseConfig = {
  region: env.aws.region,
  credentials: {
    accessKeyId: env.aws.accessKeyId,
    secretAccessKey: env.aws.secretAccessKey,
  },
};

export const sesClient = new SESClient({ ...baseConfig });
export const s3Client = new S3Client({ ...baseConfig });
