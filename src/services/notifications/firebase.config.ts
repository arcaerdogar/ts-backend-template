import admin from "firebase-admin";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { env } from "../../config/env.js";

/**
 * Firebase Admin SDK lazy init. Uygulama başlarken değil, ilk gönderimde
 * (getMessaging) init edilir; böylece FCM yapılandırılmamış projeler bu modülü
 * import etse de patlamaz.
 *
 * İki credential kaynağı: (1) service account JSON dosya yolu, (2) env üçlüsü
 * (projectId + clientEmail + privateKey). Hiçbiri yoksa init hata fırlatır,
 * ancak isFirebaseConfigured() zaten false döneceği için servis katmanı
 * getMessaging'i hiç çağırmaz (no-op).
 */
let app: admin.app.App | null = null;

function initFirebase(): admin.app.App {
  if (app) return app;

  const { firebase } = env;
  const hasServiceAccount =
    firebase.serviceAccountPath ||
    (firebase.projectId && firebase.clientEmail && firebase.privateKey);

  if (!hasServiceAccount) {
    throw new Error(
      "Firebase not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
  }

  if (firebase.serviceAccountPath) {
    const serviceAccount = JSON.parse(
      readFileSync(resolve(firebase.serviceAccountPath), "utf-8")
    );
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: firebase.projectId!,
        clientEmail: firebase.clientEmail!,
        privateKey: firebase.privateKey!,
      }),
    });
  }

  return app;
}

export function getMessaging(): admin.messaging.Messaging {
  return initFirebase().messaging();
}

/**
 * FCM yapılandırılmış mı? Servis/worker katmanı her gönderimden önce bunu
 * kontrol eder; false ise gönderim sessizce atlanır (template Firebase olmadan
 * çalışabilir).
 */
export function isFirebaseConfigured(): boolean {
  const { firebase } = env;
  if (firebase.serviceAccountPath) {
    return existsSync(resolve(firebase.serviceAccountPath));
  }
  return !!(firebase.projectId && firebase.clientEmail && firebase.privateKey);
}
