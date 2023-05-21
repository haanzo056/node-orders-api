import nodemailer from 'nodemailer';

export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
  close(): void;
}

export function createMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(msg) {
      await transport.sendMail({ from, ...msg });
    },
    close: () => transport.close(),
  };
}
