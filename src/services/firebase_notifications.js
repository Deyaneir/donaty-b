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
  return {
    successCount: response.successCount ?? 0,
    failureCount: response.failureCount ?? 0,
  };
};

const notifyUsers = async ({
  eventKey,
  recipients,
  title,
  body,
  data = {},
}) => {
  if (!eventKey) return { status: "invalid_event" };

  try {
    const normalizedRecipients = normalizeRecipients(recipients);
    if (!normalizedRecipients.length) return { status: "no_recipients" };

    const persisted = [];
    for (const recipient of normalizedRecipients) {
      try {
        const notification = await NotificationEvent.findOneAndUpdate(
          {
            eventKey,
            recipientId: recipient.userId,
            recipientRole: recipient.role,
          },
          {
            $setOnInsert: {
              eventKey,
              recipientId: recipient.userId,
              recipientRole: recipient.role,
              type: String(data.type || data.tipo || "notification"),
              title,
              body,
              donationId: data.donationId || data.donacionId || null,
              campaignId: data.campaignId || data.campanaId || null,
              conversationId: String(data.roomId || data.conversationId || ""),
              data,
              readAt: null,
              pushStatus: "pending",
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        persisted.push(notification);
      } catch (error) {
        if (error?.code === 11000) continue;
        console.error("Error persistiendo notificación:", error.message || error);
      }
    }
    if (!persisted.length) return { status: "duplicate" };
    if (!firebaseApp) {
      await NotificationEvent.updateMany(
        { _id: { $in: persisted.map((item) => item._id) } },
        { $set: { pushStatus: "disabled" } }
      );
      return { status: "disabled", persisted: persisted.length };
    }

    const deviceFilter = {
      active: true,
      $or: normalizedRecipients.map(({ userId, role }) => ({ userId, role })),
    };
    const devices = await FcmDevice.find(deviceFilter).select("token").lean();
    const tokens = devices.map((device) => device.token).filter(Boolean);
    if (!tokens.length) {
      await NotificationEvent.updateMany(
        { _id: { $in: persisted.map((item) => item._id) } },
        { $set: { pushStatus: "no_devices" } }
      );
      return { status: "no_devices", persisted: persisted.length };
    }

    const messaging = getMessaging(firebaseApp);
    const safeData = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, String(value ?? "")])
    );
    let successCount = 0;
    let failureCount = 0;
    for (let index = 0; index < tokens.length; index += 500) {
      const result = await sendBatch(
        messaging,
        tokens.slice(index, index + 500),
        { title, body },
        safeData
      );
      successCount += result.successCount;
      failureCount += result.failureCount;
    }
    const pushStatus = failureCount === 0
      ? "sent"
      : successCount === 0
        ? "failed"
        : "partial_failure";
    await NotificationEvent.updateMany(
      { _id: { $in: persisted.map((item) => item._id) } },
      {
        $set: {
          pushStatus,
          ...(failureCount === 0 ? { pushSentAt: new Date() } : {}),
        },
      }
    );
    return {
      status: pushStatus,
      persisted: persisted.length,
      successCount,
      failureCount,
    };
  } catch (error) {
    console.error("Error enviando notificación push:", error.message || error);
    return { status: "failed" };
  }
};

export { notifyUsers };
