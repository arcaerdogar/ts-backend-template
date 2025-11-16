import { sendEmail } from "./aws.ses.js";
import { env } from "../../config/env.js";
import { renderTemplate } from "./templates/template.loader.js";

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

  async sendPasswordResetEmail(to: string, link: string, username: string) {
    const html = renderTemplate("password-reset", {
      USERNAME: username,
      RESET_LINK: link,
    });
    return this.send({
      to,
      subject: "Şifre Sıfırlama Talebi",
      html: `<a href="${link}">Şifre Sıfırla</a>`,
      text: `Link: ${link}`,
    });
  }

  async sendEmailChangeEmail(to: string, link: string, username: string) {
    const html = renderTemplate("email-change", {
      USERNAME: username,
      CONFIRM_LINK: link,
    });
    return this.send({
      to,
      subject: "Email Değiştirme Talebi",
      html: `<a href="${link}">Emailini sıfırla</a>`,
      text: `Link: ${link}`,
    });
  }

  async sendVerificationEmail(to: string, link: string, username: string) {
    const html = renderTemplate("verify-email", {
      USERNAME: username,
      VERIFY_LINK: link,
    });
    return this.send({
      to,
      subject: "Hesap Doğrulama",
      html,
      text: `Link: ${link}`,
    });
  }
}
