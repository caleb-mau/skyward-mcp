import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  chromium,
  type BrowserContext,
  type Request,
  type Response,
} from "playwright-core";
import {
  buildManifest,
  manifestMarkdown,
  sanitizeRequestBody,
  sanitizeResponseStructure,
  sanitizeUrl,
  StableRedactor,
} from "./sanitize";
import type {
  DiscoveryEvent,
  DiscoveryNavigation,
} from "./types";

const MAX_RESPONSE_STRUCTURE_BYTES = 2 * 1024 * 1024;

export interface DiscoverBrowserOptions {
  startUrl: string;
  captureOrigin?: string;
  outputDirectory: string;
  browserPath?: string;
  stop: () => Promise<void>;
}

export interface DiscoverBrowserResult {
  manifestPath: string;
  markdownPath: string;
  eventCount: number;
  routeCount: number;
  browser: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function browserCandidates(): string[] {
  const explicit = process.env.SKYWARD_DISCOVER_BROWSER?.trim();
  const candidates = explicit ? [explicit] : [];

  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else if (process.platform === "win32") {
    const roots = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ].filter((value): value is string => Boolean(value));

    for (const root of roots) {
      candidates.push(
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(root, "Chromium", "Application", "chrome.exe"),
      );
    }
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }

  return [...new Set(candidates)];
}

export async function findInstalledBrowser(
  explicitPath?: string,
): Promise<string> {
  if (explicitPath) {
    const path = resolve(explicitPath);
    if (!(await exists(path))) {
      throw new Error(
        "The browser path does not exist: " + path,
      );
    }
    return path;
  }

  for (const candidate of browserCandidates()) {
    if (await exists(candidate)) return candidate;
  }

  throw new Error(
    [
      "Could not find Google Chrome, Microsoft Edge, or Chromium.",
      "Install one of those browsers or pass --browser-path /path/to/browser.",
      "You can also set SKYWARD_DISCOVER_BROWSER.",
    ].join(" "),
  );
}

function selectedHeaders(args: {
  headers: Record<string, string>;
  captureOrigin: string;
  redactor: StableRedactor;
}): Record<string, string> {
  const output: Record<string, string> = {};

  for (const key of [
    "accept",
    "content-type",
    "x-requested-with",
  ]) {
    const value = args.headers[key];
    if (value) output[key] = value.slice(0, 300);
  }

  const referer = args.headers.referer;
  if (referer) {
    const sanitized = sanitizeUrl(
      referer,
      args.captureOrigin,
      args.redactor,
    );
    if (sanitized) {
      const keys = Object.keys(sanitized.query);
      output.referer =
        sanitized.path +
        (keys.length ? "?" + keys.sort().join("&") : "");
    }
  }

  return output;
}

function responseMime(
  headers: Record<string, string>,
): string | undefined {
  const value = headers["content-type"];
  return value?.split(";")[0]?.trim().toLowerCase();
}

function shouldInspectResponse(
  contentType: string | undefined,
  resourceType: string,
): boolean {
  if (!contentType) return false;

  if (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript")
  ) {
    return true;
  }

  return ["document", "xhr", "fetch", "script"].includes(
    resourceType,
  );
}

async function inspectResponse(args: {
  response: Response;
  event: DiscoveryEvent;
  captureOrigin: string;
  redactor: StableRedactor;
}): Promise<void> {
  const headers = await args.response.allHeaders();
  const contentType = responseMime(headers);

  args.event.response = {
    status: args.response.status(),
    ...(contentType ? { content_type: contentType } : {}),
  };

  if (
    !shouldInspectResponse(
      contentType,
      args.event.resource_type,
    )
  ) {
    return;
  }

  const declaredLength = Number(
    headers["content-length"] || "0",
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_STRUCTURE_BYTES
  ) {
    return;
  }

  try {
    const body = await args.response.body();
    const limited =
      body.byteLength > MAX_RESPONSE_STRUCTURE_BYTES
        ? body.subarray(0, MAX_RESPONSE_STRUCTURE_BYTES)
        : body;

    args.event.response.structure =
      sanitizeResponseStructure({
        body: limited,
        contentType,
        captureOrigin: args.captureOrigin,
        redactor: args.redactor,
      });
  } catch {
    // Redirects, downloads, and aborted requests may not have a readable body.
  }
}

function eventFromRequest(args: {
  request: Request;
  captureOrigin: string;
  redactor: StableRedactor;
}): DiscoveryEvent | null {
  const sanitized = sanitizeUrl(
    args.request.url(),
    args.captureOrigin,
    args.redactor,
  );
  if (!sanitized) return null;

  const headers = args.request.headers();
  const contentType = headers["content-type"];

  return {
    at: new Date().toISOString(),
    method: args.request.method().toUpperCase(),
    path: sanitized.path,
    resource_type: args.request.resourceType(),
    query: sanitized.query,
    headers: selectedHeaders({
      headers,
      captureOrigin: args.captureOrigin,
      redactor: args.redactor,
    }),
    request: sanitizeRequestBody({
      contentType,
      postData: args.request.postData(),
      redactor: args.redactor,
    }),
  };
}

function browserLabel(path: string): string {
  const name = basename(path);
  if (/edge/i.test(name)) return "Microsoft Edge";
  if (/chromium/i.test(name)) return "Chromium";
  if (/chrome/i.test(name)) return "Google Chrome";
  return name;
}

export async function runBrowserDiscovery(
  options: DiscoverBrowserOptions,
): Promise<DiscoverBrowserResult> {
  const startUrl = new URL(options.startUrl);
  if (
    startUrl.protocol !== "https:" &&
    startUrl.hostname !== "localhost" &&
    startUrl.hostname !== "127.0.0.1"
  ) {
    throw new Error(
      "Skyward discovery requires an HTTPS start URL except for localhost development.",
    );
  }

  const captureOrigin = options.captureOrigin
    ? new URL(options.captureOrigin).origin
    : startUrl.origin;

  const browserPath = await findInstalledBrowser(
    options.browserPath,
  );
  const profileDirectory = await mkdtemp(
    join(tmpdir(), "skyward-mcp-discover-"),
  );

  const events: DiscoveryEvent[] = [];
  const navigations: DiscoveryNavigation[] = [];
  const eventByRequest = new WeakMap<Request, DiscoveryEvent>();
  const pending = new Set<Promise<void>>();
  const redactor = new StableRedactor();

  let context: BrowserContext | undefined;

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

    context.on("request", (request) => {
      const event = eventFromRequest({
        request,
        captureOrigin,
        redactor,
      });
      if (!event) return;
      events.push(event);
      eventByRequest.set(request, event);
    });

    context.on("response", (response) => {
      const event = eventByRequest.get(response.request());
      if (!event) return;

      const task = inspectResponse({
        response,
        event,
        captureOrigin,
        redactor,
      }).finally(() => pending.delete(task));
      pending.add(task);
    });

    const attachedPages = new WeakSet<object>();
    const attachPage = (page: ReturnType<BrowserContext["pages"]>[number]) => {
      if (attachedPages.has(page)) return;
      attachedPages.add(page);

      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        const sanitized = sanitizeUrl(
          frame.url(),
          captureOrigin,
          redactor,
        );
        if (!sanitized) return;

        const keys = Object.keys(sanitized.query);
        navigations.push({
          at: new Date().toISOString(),
          path:
            sanitized.path +
            (keys.length
              ? "?" + keys.sort().join("&")
              : ""),
        });
      });
    };

    context.on("page", attachPage);

    let pages = context.pages();
    for (const page of pages) attachPage(page);

    if (!pages.length) {
      const page = await context.newPage();
      attachPage(page);
      pages = [page];
    }

    await pages[0]?.goto(startUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    }).catch(() => undefined);

    await options.stop();
    await Promise.allSettled([...pending]);

    const manifest = buildManifest({
      captureOrigin,
      browser: browserLabel(browserPath),
      events,
      navigations,
    });

    await mkdir(options.outputDirectory, {
      recursive: true,
      mode: 0o700,
    });

    const manifestPath = join(
      options.outputDirectory,
      "routes.json",
    );
    const markdownPath = join(
      options.outputDirectory,
      "routes.md",
    );

    await Promise.all([
      writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2) + "\n",
        { mode: 0o600 },
      ),
      writeFile(
        markdownPath,
        manifestMarkdown(manifest),
        { mode: 0o600 },
      ),
    ]);

    return {
      manifestPath,
      markdownPath,
      eventCount: manifest.events.length,
      routeCount: manifest.routes.length,
      browser: manifest.browser,
    };
  } finally {
    await context?.close().catch(() => undefined);
    await rm(profileDirectory, {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
}
