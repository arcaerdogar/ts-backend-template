import { sesClient } from "../aws/aws.config.js";
import { SendEmailCommand } from "@aws-sdk/client-ses";

export interface SendEmailParams {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
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
    Source: process.env.SES_SENDER_EMAIL!,
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
