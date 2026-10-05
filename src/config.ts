import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  SkywardSession,
  createSkywardClient,
  loginWithPassword,
  type SkywardClient,
  type SkywardSessionExport,
} from "skyward-rest";

export type AuthSource =
  | "session_b64"
  | "session_env"
  | "session_file"
  | "native_password_env";

export interface LoadedSkyward {
  client: SkywardClient;
  source: AuthSource;
}

let cached: Promise<LoadedSkyward> | undefined;

export function defaultSessionPath(): string {
  return join(homedir(), ".skyward-mcp", "session.json");
}

export function configuredSessionPath(): string {
  const configured = process.env.SKYWARD_SESSION_FILE?.trim();
  return configured ? resolve(configured) : defaultSessionPath();
}

function timeoutMs(): number {
  const value = Number(process.env.SKYWARD_TIMEOUT_MS || 30_000);
  return Number.isFinite(value) && value >= 1_000
    ? Math.min(value, 300_000)
    : 30_000;
}

export function parseSessionJson(
  raw: string,
): SkywardSessionExport {
  const parsed = JSON.parse(raw) as SkywardSessionExport;
  return SkywardSession.from(parsed).export();
}

export function parseSessionBase64(
  raw: string,
): SkywardSessionExport {
  const normalized = raw.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("SKYWARD_SESSION_B64 is not valid base64.");
  }

  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  if (!decoded.trim().startsWith("{")) {
    throw new Error("SKYWARD_SESSION_B64 did not decode to a Skyward session JSON object.");
  }
  return parseSessionJson(decoded);
}

async function fromSessionExport(
  session: SkywardSessionExport,
  source: AuthSource,
): Promise<LoadedSkyward> {
  return {
    source,
    client: createSkywardClient({
      session,
      timeoutMs: timeoutMs(),
    }),
  };
}

async function loadUncached(): Promise<LoadedSkyward> {
  const sessionB64 = process.env.SKYWARD_SESSION_B64?.trim();
  if (sessionB64) {
    return fromSessionExport(
      parseSessionBase64(sessionB64),
      "session_b64",
    );
  }

  const sessionJson = process.env.SKYWARD_SESSION_JSON?.trim();
  if (sessionJson) {
    return fromSessionExport(
      parseSessionJson(sessionJson),
      "session_env",
    );
  }

  const explicitSessionFile =
    process.env.SKYWARD_SESSION_FILE?.trim();
  const sessionPath = configuredSessionPath();

  try {
    const raw = await readFile(sessionPath, "utf8");
    return fromSessionExport(
      parseSessionJson(raw),
      "session_file",
    );
  } catch (error) {
    if (
      explicitSessionFile &&
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const loginUrl = process.env.SKYWARD_LOGIN_URL?.trim();
  const username = process.env.SKYWARD_USERNAME?.trim();
  const password = process.env.SKYWARD_PASSWORD;

  if (loginUrl && username && password) {
    return {
      source: "native_password_env",
      client: await loginWithPassword({
        loginUrl,
        username,
        password,
        timeoutMs: timeoutMs(),
      }),
    };
  }

  throw new Error(
    "Skyward is not configured. Run npm run setup locally, provide SKYWARD_SESSION_B64 or SKYWARD_SESSION_JSON, point SKYWARD_SESSION_FILE at a valid session export, or configure compatible SMS 2.0 login credentials.",
  );
}

export async function loadSkyward(): Promise<LoadedSkyward> {
  cached ||= loadUncached();
  try {
    return await cached;
  } catch (error) {
    cached = undefined;
    throw error;
  }
}

export function clearSkywardCache(): void {
  cached = undefined;
}

export async function saveLocalSession(
  session: SkywardSessionExport,
  path = configuredSessionPath(),
): Promise<string> {
  const validated = SkywardSession.from(session).export();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    JSON.stringify(validated, null, 2) + "\n",
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
  clearSkywardCache();
  return path;
}

export async function importSessionFile(
  sourcePath: string,
): Promise<string> {
  const raw = await readFile(resolve(sourcePath), "utf8");
  return saveLocalSession(parseSessionJson(raw));
}

export async function authenticateAndSave(args: {
  loginUrl: string;
  username: string;
  password: string;
}): Promise<{
  path: string;
  summary: ReturnType<SkywardClient["sessionSummary"]>;
}> {
  const client = await loginWithPassword({
    ...args,
    timeoutMs: timeoutMs(),
  });

  const path = await saveLocalSession(client.exportSession());
  return {
    path,
    summary: client.sessionSummary(),
  };
}

export async function redactedRuntimeConfig() {
  const loaded = await loadSkyward();
  return {
    auth_source: loaded.source,
    session: loaded.client.sessionSummary(),
    capabilities: {
      generation: loaded.client.capabilities().generation,
      role: loaded.client.capabilities().role,
      capabilities: [
        ...loaded.client.capabilities().capabilities,
      ],
    },
    session_file:
      loaded.source === "session_file"
        ? configuredSessionPath()
        : undefined,
  };
}
