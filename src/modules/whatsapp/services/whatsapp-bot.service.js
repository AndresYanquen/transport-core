const { logger } = require("../../../config/logger");
const AuthModel = require("../../auth/models/auth.model");
const { normalizePhoneNumber } = require("../../auth/utils/phone");
const RideService = require("../../rides/services/ride.service");
const WhatsappSessionModel = require("../models/whatsapp-session.model");

const SESSION_TTL_MS = 30 * 60 * 1000;
const STATES = {
  START: "START",
  WAITING_PICKUP: "WAITING_PICKUP",
  WAITING_CONFIRMATION: "WAITING_CONFIRMATION",
};

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function expiresAt() {
  return new Date(Date.now() + SESSION_TTL_MS);
}

function isTaxiIntent(text = "") {
  return /\b(taxi|carro|viaje|servicio)\b/i.test(text);
}

function isConfirmation(text = "") {
  return /^(si|sí|confirmo|confirmar|ok|dale|listo|1)$/i.test(text.trim());
}

function buildKapsoTestPhone(phone) {
  return phone ? `t${phone}` : null;
}

function buildKapsoTestContext(payload = {}, message = {}) {
  return {
    kapsoTest: true,
    realPhone: message.phone || null,
    kapsoConversationId: payload.conversation?.id || null,
    kapsoUsername:
      payload.conversation?.username ||
      payload.message?.username ||
      null,
    kapsoContactName: payload.conversation?.contact_name || null,
    kapsoMessageId: payload.message?.id || null,
    lastText: message.text || null,
  };
}

async function ensureWhatsappClient(phone) {
  const existingClient = await AuthModel.findClientByPhoneNumber(phone);
  if (existingClient) {
    return {
      client: existingClient,
      created: false,
    };
  }

  const client = await AuthModel.createPhoneOnlyClient({
    phoneNumber: phone,
    firstName: "WhatsApp",
    lastName: null,
    createdByOperatorId: null,
    source: "whatsapp",
  });

  return {
    client,
    created: true,
  };
}

function buildResponse({ reply, session, ride = null }) {
  return {
    reply,
    state: session?.state ?? null,
    rideId: ride?.id ?? null,
  };
}

async function handleMessage({ payload, message }) {
  if (!message.phone) {
    throw createHttpError(400, "Kapso WhatsApp payload must include sender phone.");
  }

  const phone = normalizePhoneNumber(message.phone);
  const { client, created } = await ensureWhatsappClient(phone);
  const existingSession = await WhatsappSessionModel.findByPhone(phone);
  const session =
    existingSession && new Date(existingSession.expiresAt).getTime() > Date.now()
      ? existingSession
      : await WhatsappSessionModel.resetSession({
          phone,
          userId: client.id,
          expiresAt: expiresAt(),
        });

  if (created) {
    session.context.phoneOnlyClientCreated = true;
  }

  const text = message.text || "";

  if (session.state === STATES.START) {
    if (!isTaxiIntent(text)) {
      const nextSession = await WhatsappSessionModel.upsertSession({
        phone,
        userId: client.id,
        state: STATES.START,
        context: {},
        expiresAt: expiresAt(),
      });

      return buildResponse({
        session: nextSession,
        reply: "Hola. Responde Taxi para pedir un servicio.",
      });
    }

    const nextSession = await WhatsappSessionModel.upsertSession({
      phone,
      userId: client.id,
      state: STATES.WAITING_PICKUP,
      context: { serviceType: "standard" },
      expiresAt: expiresAt(),
    });

    return buildResponse({
      session: nextSession,
      reply: "Listo. Comparte tu ubicacion de origen por WhatsApp.",
    });
  }

  if (session.state === STATES.WAITING_PICKUP) {
    if (!message.location) {
      return buildResponse({
        session,
        reply: "Necesito la ubicacion de origen. Usa compartir ubicacion en WhatsApp.",
      });
    }

    const nextSession = await WhatsappSessionModel.upsertSession({
      phone,
      userId: client.id,
      state: STATES.WAITING_CONFIRMATION,
      context: {
        ...session.context,
        pickupLat: message.location.lat,
        pickupLng: message.location.lng,
        pickupAddress: message.location.address || "Ubicacion compartida por WhatsApp",
      },
      expiresAt: expiresAt(),
    });

    return buildResponse({
      session: nextSession,
      reply: `Recibido. Confirma tu taxi desde ${nextSession.context.pickupAddress}. Responde SI para confirmar.`,
    });
  }

  if (session.state === STATES.WAITING_CONFIRMATION) {
    if (!isConfirmation(text)) {
      return buildResponse({
        session,
        reply: "Servicio pendiente de confirmacion. Responde SI para confirmar o Taxi para empezar de nuevo.",
      });
    }

    const rideResult = await RideService.createRide({
      clientId: client.id,
      serviceType: session.context.serviceType || "standard",
      pickupAddress: session.context.pickupAddress || "Ubicacion compartida por WhatsApp",
      pickupLocation: {
        lat: session.context.pickupLat,
        lng: session.context.pickupLng,
      },
      requestDescription: session.context.dropoffAddress
        ? `Destino WhatsApp: ${session.context.dropoffAddress}`
        : null,
      hasDestination: false,
      source: "whatsapp",
      actorType: "client",
      actorId: client.id,
      metadata: {
        source: "whatsapp",
        provider: "kapso",
        phone,
        dropoffAddressText: session.context.dropoffAddress || null,
        rawMessage: payload,
      },
    });

    const nextSession = await WhatsappSessionModel.resetSession({
      phone,
      userId: client.id,
      expiresAt: expiresAt(),
    });

    logger.info("kapso_ride_created", {
      rideId: rideResult.ride.id,
      phone,
      source: "whatsapp",
    });

    return buildResponse({
      session: nextSession,
      ride: rideResult.ride,
      reply: `Servicio creado. Estamos buscando conductor. ID: ${rideResult.ride.id}`,
    });
  }

  const nextSession = await WhatsappSessionModel.resetSession({
    phone,
    userId: client.id,
    expiresAt: expiresAt(),
  });

  return buildResponse({
    session: nextSession,
    reply: "Reiniciamos la conversacion. Responde Taxi para pedir un servicio.",
  });
}

async function handleTestMessage({ payload, message }) {
  if (!message.phone) {
    throw createHttpError(400, "Kapso test payload must include sender phone.");
  }

  const phone = buildKapsoTestPhone(message.phone);
  const nextSession = await WhatsappSessionModel.upsertSession({
    phone,
    userId: null,
    state: STATES.START,
    context: buildKapsoTestContext(payload, message),
    expiresAt: expiresAt(),
  });

  return buildResponse({
    session: nextSession,
    reply: "Kapso test payload received.",
  });
}

module.exports = {
  handleMessage,
  handleTestMessage,
  __private: {
    STATES,
    buildKapsoTestContext,
    buildKapsoTestPhone,
    buildResponse,
    createHttpError,
    isConfirmation,
    isTaxiIntent,
  },
};
