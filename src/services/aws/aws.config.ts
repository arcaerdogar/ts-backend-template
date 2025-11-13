import { SESClient } from "@aws-sdk/client-ses";
import { env } from "../../config/env.js";

const baseConfig = {
  region: env.aws.region,
  credentials: {
    accessKeyId: env.aws.accessKeyId,
    secretAccessKey: env.aws.secretAccessKey,
  },
};

export const sesClient = new SESClient({ ...baseConfig });
