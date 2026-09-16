const { env } = require("../../../config");
const { logger } = require("../../../config/logger");

let transporter;

function isMailConfigured() {
  return Boolean(env.mail.host && env.mail.user && env.mail.password && env.mail.from);
}

function getTransporter() {
  if (!transporter) {
    const nodemailer = require("nodemailer");
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: {
        user: env.mail.user,
        pass: env.mail.password,
      },
    });
  }

  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  if (!isMailConfigured()) {
    logger.warn("mail_not_configured", { to, subject, text });
    return { skipped: true };
  }

  return getTransporter().sendMail({
    from: env.mail.from,
    to,
    subject,
    text,
    html,
  });
}

function buildPasswordResetContent(resetUrl) {
  return {
    subject: "Recupera tu contraseña de GotTaxi",
    text: [
      "Recibimos una solicitud para restablecer tu contraseña de GotTaxi.",
      `Abre este enlace para crear una nueva contraseña: ${resetUrl}`,
      "Este enlace vence en 30 minutos. Si no solicitaste este cambio, ignora este correo.",
    ].join("\n\n"),
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña de GotTaxi.</p>
      <p><a href="${resetUrl}">Crear una nueva contraseña</a></p>
      <p>Este enlace vence en 30 minutos. Si no solicitaste este cambio, ignora este correo.</p>
    `,
  };
}

function buildEmailVerificationContent(verificationUrl) {
  return {
    subject: "Verifica tu correo de GotTaxi",
    text: [
      "Gracias por registrarte en GotTaxi.",
      `Confirma tu correo abriendo este enlace: ${verificationUrl}`,
      "Este enlace vence en 24 horas.",
    ].join("\n\n"),
    html: `
      <p>Gracias por registrarte en GotTaxi.</p>
      <p><a href="${verificationUrl}">Confirmar mi correo</a></p>
      <p>Este enlace vence en 24 horas.</p>
    `,
  };
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  return sendMail({
    to,
    ...buildPasswordResetContent(resetUrl),
  });
}

async function sendEmailVerificationEmail({ to, verificationUrl }) {
  return sendMail({
    to,
    ...buildEmailVerificationContent(verificationUrl),
  });
}

function setTransporterForTests(nextTransporter) {
  transporter = nextTransporter;
}

module.exports = {
  isMailConfigured,
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
  setTransporterForTests,
};
