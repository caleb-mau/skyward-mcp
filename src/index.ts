#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server";
import {
  checkLocalSession,
  importSessionFromCli,
  printVercelEnv,
  printVercelSession,
  runBrowserSsoSetup,
  runLocalSetup,
} from "./setup";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "setup") {
    if (args.includes("--check-session")) {
      await checkLocalSession();
      return;
    }

    if (args.includes("--vercel-session")) {
      await printVercelSession();
      return;
    }

    if (args.includes("--vercel-env")) {
      await printVercelEnv();
      return;
    }

    const ssoIndex = args.indexOf("--sso");
    if (ssoIndex >= 0) {
      const maybeUrl = args[ssoIndex + 1];
      await runBrowserSsoSetup(
        maybeUrl && !maybeUrl.startsWith("--")
          ? maybeUrl
          : undefined,
      );
      return;
    }

    const importIndex = args.indexOf("--import-session");
    if (importIndex >= 0) {
      const path = args[importIndex + 1];
      if (!path) {
        throw new Error(
          "--import-session requires a path to a SkywardSessionExport JSON file.",
        );
      }
      await importSessionFromCli(path);
      return;
    }

    await runLocalSetup();
    return;
  }

  if (
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    process.stdout.write(
      [
        "skyward-mcp",
        "",
        "Usage:",
        "  skyward-mcp                         Start MCP over stdio",
        "  skyward-mcp setup                   Configure compatible SMS 2.0 login locally",
        "  skyward-mcp setup --sso [URL]       Authenticate through the real browser SSO flow",
        "  skyward-mcp setup --import-session PATH",
        "                                      Import a SkywardSessionExport from a browser SSO flow",
        "  skyward-mcp setup --check-session     Validate the saved Skyward session",
        "  skyward-mcp setup --vercel-session    Print only SKYWARD_SESSION_B64 for session refresh",
        "  skyward-mcp setup --vercel-env        Print two secret values for initial Vercel deploy",
        "",
      ].join("\n"),
    );
    return;
  }

  const handle = serveStdio(() => createServer());
  process.on("SIGINT", () => void handle.close());
  process.on("SIGTERM", () => void handle.close());
}

main().catch((error) => {
  process.stderr.write(
    (error instanceof Error
      ? error.stack || error.message
      : String(error)) + "\n",
  );
  process.exitCode = 1;
});
