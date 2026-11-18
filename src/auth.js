import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function loadServiceAccount() {
  const inline = process.env.CRASHLYTICS_SA_KEY;
  if (inline) return JSON.parse(inline.trim().startsWith("{") ? inline : Buffer.from(inline, "base64").toString("utf8"));
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) return JSON.parse(readFileSync(path, "utf8"));
  return null;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

async function tokenFromServiceAccount(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${signer.sign(sa.private_key).toString("base64url")}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`No se pudo obtener token de la cuenta de servicio: ${body.error_description ?? body.error}`);
  return body.access_token;
}

// A `firebase login:ci` refresh token only works with the OAuth client that issued it, which is
// the Firebase CLI's public installed-app client (the same values firebase-tools ships).
const FIREBASE_CLI_CLIENT_ID =
  process.env.FIREBASE_CLIENT_ID ?? "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET = process.env.FIREBASE_CLIENT_SECRET ?? "j9iVZfS8kkCEFUPaAeJV0sAi";

async function tokenFromRefreshToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: FIREBASE_CLI_CLIENT_ID,
      client_secret: FIREBASE_CLI_CLIENT_SECRET,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `FIREBASE_TOKEN rechazado (${body.error}): ${body.error_description ?? ""}. ` +
        "Genera uno nuevo con `npx firebase-tools login:ci` y actualiza el secreto."
    );
  }
  return body.access_token;
}

let cached;

export async function getAccessToken() {
  if (cached) return cached;
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    cached = process.env.GOOGLE_OAUTH_ACCESS_TOKEN.trim();
    return cached;
  }
  if (process.env.FIREBASE_TOKEN) {
    cached = await tokenFromRefreshToken(process.env.FIREBASE_TOKEN.trim());
    return cached;
  }
  const sa = loadServiceAccount();
  if (!sa) {
    throw new Error(
      "Faltan credenciales de Firebase: define FIREBASE_TOKEN (de `firebase login:ci`), " +
        "CRASHLYTICS_SA_KEY (JSON de la cuenta de servicio) o GOOGLE_APPLICATION_CREDENTIALS."
    );
  }
  cached = await tokenFromServiceAccount({ token_uri: "https://oauth2.googleapis.com/token", ...sa });
  return cached;
}
