import nodemailer from 'nodemailer';
import { env } from '../config/env.ts';

export function emailConfigured(): boolean {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.notifyEmail);
}

export async function sendEmail(opts: {
  subject: string;
  text: string;
  to?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!emailConfigured()) {
    return {
      ok: false,
      error: 'Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and NOTIFY_EMAIL in .env',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });

    await transporter.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: opts.to || env.notifyEmail,
      subject: opts.subject,
      text: opts.text,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
