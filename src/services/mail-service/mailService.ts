import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

interface SendMailTemplate {
  to: string;
  subject?: string;
  html?: string;
  text?: string;
  attachments?: nodemailer.SendMailOptions["attachments"];
}

class MailSender {
  static transporter = nodemailer.createTransport({
    host: env.mailService.host,
    port: Number(env.mailService.port),
    secure: env.mailService.secure === "true", // 465 için true; 587 için false
    auth: {
      user: env.mailService.user,
      pass: env.mailService.pass,
    },
  });

  static async sendMail({
    to,
    subject,
    html,
    text,
    attachments,
  }: SendMailTemplate) {
    try {
      const info = await this.transporter.sendMail({
        from: process.env.MAIL_FROM,
        to,
        subject,
        html,
        text,
        attachments,
      });

      console.log("Mail gönderildi:", info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error("Mail gönderilemedi:", err);
      return { success: false, error: err };
    }
  }

  static async sendWelcomeEmail(to: string, name: string) {
    const html = `
      <h1>Merhaba ${name} 👋</h1>
      <p>Aramıza hoş geldin!</p>
    `;

    return this.sendMail({
      to,
      subject: "Aramıza Hoş Geldin 🎉",
      html,
    });
  }
}

export default MailSender;
