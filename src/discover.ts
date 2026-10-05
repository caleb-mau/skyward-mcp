#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createInterface,
} from "node:readline/promises";
import {
  stdin as input,
  stdout as output,
} from "node:process";
import { runBrowserDiscovery } from "./discovery/browser";

interface Args {
  startUrl?: string;
  captureOrigin?: string;
  outputDirectory?: string;
  browserPath?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }

    const next = argv[index + 1];
    if (
      value === "--url" ||
      value === "--capture-origin" ||
      value === "--out" ||
      value === "--browser-path"
    ) {
      if (!next) {
        throw new Error(value + " requires a value.");
      }

      if (value === "--url") args.startUrl = next;
      if (value === "--capture-origin") {
        args.captureOrigin = next;
      }
      if (value === "--out") {
        args.outputDirectory = resolve(next);
      }
      if (value === "--browser-path") {
        args.browserPath = next;
      }

      index += 1;
      continue;
    }

    throw new Error("Unknown discovery argument: " + value);
  }

  return args;
}

function defaultOutputDirectory(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
  return join(
    homedir(),
    ".skyward-mcp",
    "discovery",
    stamp,
  );
}

function usage(): string {
  return [
    "Skyward MCP discovery recorder",
    "",
    "Usage:",
    "  npm run discover",
    "  npm run discover -- --url https://skyward.example.net/...",
    "",
    "Options:",
    "  --url URL              Initial Skyward login or portal URL",
    "  --capture-origin URL   Exact Skyward origin to record",
    "  --out PATH             Output directory",
    "  --browser-path PATH    Chrome, Edge, or Chromium executable",
    "  --help                  Show this help",
    "",
    "The recorder ignores traffic to other origins, including SSO identity providers.",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage() + "\n");
    return;
  }

  const rl = createInterface({ input, output });

  try {
    let startUrl = args.startUrl?.trim();
    if (!startUrl) {
      startUrl = (
        await rl.question(
          "Skyward login or portal URL: ",
        )
      ).trim();
    }

    if (!startUrl) {
      throw new Error("A Skyward URL is required.");
    }

    const outputDirectory =
      args.outputDirectory || defaultOutputDirectory();
    await mkdir(outputDirectory, {
      recursive: true,
      mode: 0o700,
    });

    const captureOrigin = args.captureOrigin
      ? new URL(args.captureOrigin).origin
      : new URL(startUrl).origin;

    process.stdout.write(
      [
        "",
        "Skyward discovery is starting.",
        "",
        "Capture origin: " + captureOrigin,
        "Output: " + outputDirectory,
        "",
        "Use the browser normally.",
        "Complete SSO and MFA in the real login pages.",
        "Traffic outside the capture origin is ignored.",
        "Navigate through every Skyward menu and dialog you want mapped.",
        "",
        "Raw cookies, passwords, authorization headers, session token values,",
        "student names, grades, and response text are not written to the export.",
        "",
      ].join("\n"),
    );

    let stopResolve: (() => void) | undefined;
    const stopPromise = new Promise<void>((resolveStop) => {
      stopResolve = resolveStop;
    });

    const signalStop = () => stopResolve?.();
    process.once("SIGINT", signalStop);
    process.once("SIGTERM", signalStop);

    const resultPromise = runBrowserDiscovery({
      startUrl,
      captureOrigin,
      outputDirectory,
      browserPath: args.browserPath,
      stop: async () => {
        await Promise.race([
          rl.question(
            "Press Enter here when you are done navigating Skyward...\n",
          ).then(() => undefined),
          stopPromise,
        ]);
      },
    });

    const result = await resultPromise;

    process.removeListener("SIGINT", signalStop);
    process.removeListener("SIGTERM", signalStop);

    process.stdout.write(
      [
        "",
        "Discovery complete.",
        "Browser: " + result.browser,
        "Captured requests: " + result.eventCount,
        "Unique paths: " + result.routeCount,
        "JSON: " + result.manifestPath,
        "Summary: " + result.markdownPath,
        "",
        "Review the sanitized files before sharing them.",
        "",
      ].join("\n"),
    );
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    (error instanceof Error
      ? error.stack || error.message
      : String(error)) + "\n",
  );
  process.exitCode = 1;
});
