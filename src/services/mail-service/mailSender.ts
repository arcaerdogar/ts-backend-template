import { sendEmail } from "./aws.ses.js";
import { env } from "../../config/env.js";

export class MailSender {
  private from: string;

  constructor(prefix?: string) {
    this.from = prefix
      ? `${prefix}@${env.aws.ses.senderEmail}`
      : env.aws.ses.senderEmail;
  }

  async send(options: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
  }) {
    return sendEmail({ ...options, from: this.from });
  }

  async sendPasswordResetEmail(to: string, resetLink: string) {
    return this.send({
      to,
      subject: "Şifre Sıfırlama Talebi",
      html: `<a href="${resetLink}">Şifre Sıfırla</a>`,
      text: `Link: ${resetLink}`,
    });
  }

  async sendEmailChangeEmail(to: string, link: string) {
    return this.send({
      to,
      subject: "Email Değiştirme Talebi",
      html: `<a href="${link}">Emailini sıfırla</a>`,
      text: `Link: ${link}`,
    });
  }

  async sendVerificationEmail(to: string, link: string) {
    return this.send({
      to,
      subject: "Hesap Doğrulama",
      html: `<a href="${link}">Doğrula</a>`,
      text: `Link: ${link}`,
    });
  }
}
