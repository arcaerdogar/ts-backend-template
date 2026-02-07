import { sesClient } from "../aws/aws.config.js";
import {
  SendEmailCommand,
  SendBulkTemplatedEmailCommand,
} from "@aws-sdk/client-ses";

export interface SendEmailParams {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

export interface BulkEmailDestination {
  Destination: {
    ToAddresses: string[];
    CcAddresses?: string[];
    BccAddresses?: string[];
  };
  ReplacementTemplateData?: string; // JSON string
}

export interface SendBulkEmailParams {
  template: string;
  source: string;
  defaultTemplateData?: string; // JSON string
  destinations: BulkEmailDestination[];
  replyTo?: string[];
}

export async function sendEmail(params: SendEmailParams) {
  const { to, subject, html, text, replyTo } = params;
  const recipients = Array.isArray(to) ? to : [to];

  const message: any = {
    Body: {},
  };

  if (html) {
    message.Body.Html = { Data: html };
  }

  if (text) {
    message.Body.Text = { Data: text };
  }

  const command = new SendEmailCommand({
    Source: params.from,
    Destination: { ToAddresses: recipients },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Message: {
      Subject: { Data: subject },
      ...message,
    },
  });
  const response = await sesClient.send(command);
  return response;
}

export async function sendBulkEmail(params: SendBulkEmailParams) {
  const command = new SendBulkTemplatedEmailCommand({
    Source: params.source,
    Template: params.template,
    DefaultTemplateData: params.defaultTemplateData,
    Destinations: params.destinations,
    ReplyToAddresses: params.replyTo,
  });

  return sesClient.send(command);
}
