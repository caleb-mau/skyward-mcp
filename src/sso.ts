import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  type BrowserContext,
  type Request,
} from "playwright-core";
import type {
  SkywardCookie,
  SkywardRole,
  SkywardSessionExport,
  Sms2SessionTokens,
} from "skyward-rest";
import { findInstalledBrowser } from "./discovery/browser";

export interface CapturedSms2State {
  portalRoot?: string;
  role?: SkywardRole;
  tokens: Partial<Sms2SessionTokens>;
}

export interface BrowserSsoOptions {
  startUrl: string;
  captureOrigin?: string;
  browserPath?: string;
  timeoutMs?: number;
}

function roleFromPortal(segment: string): SkywardRole {
  switch (segment.toLowerCase()) {
    case "student":
      return "student";
    case "teacher":
      return "teacher";
    case "family":
      return "parent";
    case "employee":
      return "staff";
    default:
      return "unknown";
  }
}

function portalFromPath(pathname: string): {
  root: string;
  role: SkywardRole;
} | null {
  const match = pathname.match(
    /^(.*\/(Student|Teacher|Family|Employee)\/web\/)/i,
  );
  if (!match?.[1] || !match[2]) return null;

  return {
    root: match[1],
    role: roleFromPortal(match[2]),
  };
}

function maybeStoreToken(
  state: CapturedSms2State,
  key: keyof Sms2SessionTokens,
  value: string | null,
): void {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  state.tokens[key] = trimmed;
}

export function observeSkywardRequest(args: {
  url: string;
  method?: string;
  contentType?: string;
  postData?: string | null;
  captureOrigin: string;
  state: CapturedSms2State;
}): void {
  let url: URL;
  try {
    url = new URL(args.url);
  } catch {
    return;
  }

  if (url.origin !== args.captureOrigin) return;

  const portal = portalFromPath(url.pathname);
  if (portal) {
    args.state.portalRoot = portal.root;
    args.state.role = portal.role;
  }

  const contentType = (args.contentType || "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();

  if (
    !args.postData ||
    contentType !== "application/x-www-form-urlencoded"
  ) {
    return;
  }

  const form = new URLSearchParams(args.postData);
  maybeStoreToken(args.state, "dwd", form.get("dwd"));
  maybeStoreToken(
    args.state,
    "wfaacl",
    form.get("wfaacl"),
  );
  maybeStoreToken(
    args.state,
    "encses",
    form.get("encses"),
  );
  maybeStoreToken(
    args.state,
    "sessionId",
    form.get("sessionid"),
  );
}

export function capturedSessionReady(
  state: CapturedSms2State,
): state is CapturedSms2State & {
  portalRoot: string;
  role: SkywardRole;
  tokens: Sms2SessionTokens;
} {
  return Boolean(
    state.portalRoot &&
      state.role &&
      state.tokens.dwd &&
      state.tokens.wfaacl &&
      state.tokens.encses &&
      state.tokens.sessionId,
  );
}

function playwrightCookies(
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>,
): SkywardCookie[] {
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain.replace(/^\./, ""),
    path: cookie.path,
    ...(cookie.expires > 0
      ? { expires: cookie.expires }
      : {}),
    ...(cookie.httpOnly
      ? { httpOnly: true }
      : {}),
    ...(cookie.secure
      ? { secure: true }
      : {}),
    ...(cookie.sameSite
      ? { sameSite: cookie.sameSite }
      : {}),
  }));
}

export async function captureBrowserSsoSession(
  options: BrowserSsoOptions,
): Promise<SkywardSessionExport> {
  const startUrl = new URL(options.startUrl);
  if (
    startUrl.protocol !== "https:" &&
    startUrl.hostname !== "localhost" &&
    startUrl.hostname !== "127.0.0.1"
  ) {
    throw new Error(
      "Skyward browser SSO requires HTTPS except for localhost development.",
    );
  }

  const captureOrigin = options.captureOrigin
    ? new URL(options.captureOrigin).origin
    : startUrl.origin;

  const browserPath = await findInstalledBrowser(
    options.browserPath,
  );
  const profileDirectory = await mkdtemp(
    join(tmpdir(), "skyward-mcp-sso-"),
  );

  const state: CapturedSms2State = {
    tokens: {},
  };

  let context: BrowserContext | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    context = await chromium.launchPersistentContext(
      profileDirectory,
      {
        executablePath: browserPath,
        headless: false,
        viewport: null,
        ignoreHTTPSErrors: false,
      },
    );

    const ready = new Promise<void>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? 5 * 60_000;
      timeout = setTimeout(() => {
        reject(
          new Error(
            "Timed out waiting for a complete Skyward session. Finish the district login and wait for the Skyward home page to load.",
          ),
        );
      }, timeoutMs);

      const inspect = (request: Request) => {
        const headers = request.headers();

        observeSkywardRequest({
          url: request.url(),
          method: request.method(),
          contentType: headers["content-type"],
          postData: request.postData(),
          captureOrigin,
          state,
        });

        if (capturedSessionReady(state)) {
          resolve();
        }
      };

      context?.on("request", inspect);
    });

    let pages = context.pages();
    if (!pages.length) {
      pages = [await context.newPage()];
    }

    await pages[0]?.goto(startUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    }).catch(() => undefined);

    await ready;

    if (!capturedSessionReady(state)) {
      throw new Error(
        "Skyward returned to the portal but a complete SMS session was not observed.",
      );
    }

    const baseUrl = new URL(
      state.portalRoot,
      captureOrigin,
    ).toString();

    // BrowserContext.cookies(url) only returns cookies applicable to that
    // exact URL. Asking for the bare origin can miss Skyward cookies scoped
    // to /Student/web/ or another role portal path. Read the context cookie
    // jar and keep only cookies belonging to the Skyward host instead.
    const skywardHost = new URL(baseUrl).hostname.toLowerCase();
    const allCookies = await context.cookies();
    const cookies = allCookies.filter((cookie) => {
      const domain = cookie.domain
        .replace(/^\./, "")
        .toLowerCase();

      return (
        skywardHost === domain ||
        skywardHost.endsWith("." + domain)
      );
    });

    return {
      version: 1,
      generation: "sms2",
      baseUrl,
      role: state.role,
      cookies: playwrightCookies(cookies),
      sms2: {
        ...state.tokens,
      },
      metadata: {
        auth: "browser_sso",
        portal_root: state.portalRoot,
      },
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    await context?.close().catch(() => undefined);
    await rm(profileDirectory, {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
}
