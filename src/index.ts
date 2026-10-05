#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server";
import {
  importSessionFromCli,
  printVercelEnv,
  runLocalSetup,
} from "./setup";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "setup") {
    if (args.includes("--vercel-env")) {
      await printVercelEnv();
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
        "  skyward-mcp setup --import-session PATH",
        "                                      Import a SkywardSessionExport from a browser SSO flow",
        "  skyward-mcp setup --vercel-env       Print two secret values for one click Vercel deploy",
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
