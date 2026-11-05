import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import FcmDevice from "../models/FcmDevice.js";
import NotificationEvent from "../models/NotificationEvent.js";

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
};

const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
const firebaseApp = firebaseConfigured
  ? (getApps()[0] ??
    initializeApp({
      credential: cert(firebaseConfig),
      projectId: firebaseConfig.projectId,
    }))
  : null;

if (!firebaseConfigured) {
  console.warn(
    "FCM deshabilitado: configura FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY."
  );
}

const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

const normalizeRecipients = (recipients) =>
  [...new Map(
    (recipients || [])
      .filter((recipient) => recipient?.userId && recipient?.role)
      .map((recipient) => [
        `${recipient.role}:${recipient.userId}`,
        { userId: recipient.userId, role: String(recipient.role).toLowerCase() },
      ])
  ).values()];

const claimEvent = async (eventKey) => {
  try {
    await NotificationEvent.create({ eventKey });
    return true;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

const sendBatch = async (messaging, tokens, notification, data) => {
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification,
    data,
    android: {
      priority: "high",
      notification: { channelId: "donaty_notifications" },
    },
  });

  const invalidTokens = response.responses
    .map((item, index) =>
      !item.success && INVALID_TOKEN_CODES.has(item.error?.code)
        ? tokens[index]
        : null
    )
    .filter(Boolean);

  if (invalidTokens.length) {
    await FcmDevice.updateMany(
      { token: { $in: invalidTokens } },
      { $set: { active: false } }
    );
  }
};

const notifyUsers = async ({
  eventKey,
  recipients,
  title,
  body,
  data = {},
}) => {
  if (!eventKey || !firebaseApp) return;

  try {
    if (!(await claimEvent(eventKey))) return;
    const normalizedRecipients = normalizeRecipients(recipients);
    if (!normalizedRecipients.length) return;

    const deviceFilter = {
      active: true,
      $or: normalizedRecipients.map(({ userId, role }) => ({ userId, role })),
    };
    const devices = await FcmDevice.find(deviceFilter).select("token").lean();
    const tokens = devices.map((device) => device.token).filter(Boolean);
    if (!tokens.length) return;

    const messaging = getMessaging(firebaseApp);
    const safeData = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, String(value ?? "")])
    );
    for (let index = 0; index < tokens.length; index += 500) {
      await sendBatch(
        messaging,
        tokens.slice(index, index + 500),
        { title, body },
        safeData
      );
    }
  } catch (error) {
    console.error("Error enviando notificación push:", error.message || error);
  }
};

export { notifyUsers };
