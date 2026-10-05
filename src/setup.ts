import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import {
  stdin as input,
  stdout as output,
} from "node:process";
import {
  authenticateAndSave,
  configuredSessionPath,
  importSessionFile,
  parseSessionJson,
  saveLocalSession,
} from "./config";
import { captureBrowserSsoSession } from "./sso";
import { SkywardSsoRequiredError } from "skyward-rest";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] || char,
  );
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => undefined);
  child.unref();
}

export async function printVercelEnv(): Promise<void> {
  const path = configuredSessionPath();
  const raw = await readFile(path, "utf8");
  const validated = parseSessionJson(raw);
  const encoded = Buffer.from(
    JSON.stringify(validated),
    "utf8",
  ).toString("base64");
  const token =
    process.env.MCP_AUTH_TOKEN?.trim() ||
    randomBytes(32).toString("base64url");

  process.stdout.write(
    [
      "# Treat both values below as secrets.",
      "# SKYWARD_SESSION_B64 is base64 encoding, not encryption.",
      "MCP_AUTH_TOKEN=" + token,
      "SKYWARD_SESSION_B64=" + encoded,
      "",
    ].join("\n"),
  );
}

export async function runBrowserSsoSetup(
  providedUrl?: string,
): Promise<void> {
  const rl = createInterface({ input, output });

  try {
    const startUrl =
      providedUrl?.trim() ||
      (
        await rl.question(
          "Skyward login or portal URL: ",
        )
      ).trim();

    if (!startUrl) {
      throw new Error("A Skyward URL is required.");
    }

    process.stderr.write(
      [
        "",
        "Opening a temporary browser profile for Skyward SSO.",
        "Complete your normal district login and MFA.",
        "Identity provider credentials stay inside the browser.",
        "The local process only watches requests back to the Skyward origin",
        "for the resulting Skyward session fields.",
        "",
      ].join("\n"),
    );

    const session = await captureBrowserSsoSession({
      startUrl,
    });
    const path = await saveLocalSession(session);

    process.stderr.write(
      [
        "",
        "Skyward browser session captured.",
        "Saved to: " + path,
        "Portal: " + session.baseUrl,
        "Role hint: " + (session.role || "unknown"),
        "",
        "You can now start the MCP locally or run npm run vercel:env.",
        "",
      ].join("\n"),
    );
  } finally {
    rl.close();
  }
}

export async function importSessionFromCli(
  path: string,
): Promise<void> {
  const destination = await importSessionFile(path);
  process.stderr.write(
    "Imported Skyward session to " + destination + "\n",
  );
}

export async function runLocalSetup(): Promise<void> {
  const server = createServer(async (req, res) => {
    const url = new URL(
      req.url || "/",
      "http://127.0.0.1",
    );

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'unsafe-inline'; form-action 'self'",
    );

    if (
      req.method === "POST" &&
      url.pathname === "/connect"
    ) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) {
          res.writeHead(413).end("Too large");
          return;
        }
      }

      try {
        const form = new URLSearchParams(body);
        const loginUrl = String(form.get("loginUrl") || "");
        const username = String(form.get("username") || "");
        const password = String(form.get("password") || "");

        if (!loginUrl || !username || !password) {
          throw new Error(
            "Login URL, username, and password are required.",
          );
        }

        const result = await authenticateAndSave({
          loginUrl,
          username,
          password,
        });

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
        });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Skyward MCP configured</title><style>body{font-family:system-ui;max-width:760px;margin:60px auto;padding:0 24px;line-height:1.6}code{background:#eee;padding:2px 5px;border-radius:4px}</style><h1>Skyward MCP is ready</h1><p>The authenticated Skyward session was saved locally to <code>${escapeHtml(result.path)}</code>.</p><p>The password was used only for the login request and was not written to the session file.</p><p>Detected generation: <strong>${escapeHtml(result.summary.generation)}</strong>. Role hint: <strong>${escapeHtml(result.summary.role)}</strong>.</p><p>You can close this tab and start your MCP client.</p>`,
        );
        setTimeout(() => server.close(), 250);
      } catch (error) {
        const sso =
          error instanceof SkywardSsoRequiredError;
        res.writeHead(400, {
          "Content-Type": "text/html; charset=utf-8",
        });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Skyward MCP setup</title><style>body{font-family:system-ui;max-width:760px;margin:60px auto;padding:0 24px;line-height:1.6}pre{white-space:pre-wrap;background:#f4f4f4;padding:16px;border-radius:8px}</style><h1>${sso ? "Interactive SSO is required" : "Could not connect"}</h1><pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>${sso ? "<p>This setup page will not ask for your Microsoft, Google, ClassLink, Clever, or district identity provider password. Authenticate through the real district browser flow, then import the resulting SkywardSessionExport with <code>npm run setup -- --import-session path.json</code>.</p>" : ""}<p><a href="/">Go back</a></p>`,
        );
      }
      return;
    }

    if (req.method !== "GET" || url.pathname !== "/") {
      res.writeHead(404).end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });
    res.end(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skyward MCP setup</title>
<style>
body{font-family:system-ui;background:#f5f5f5;color:#171717;margin:0}
.card{max-width:720px;margin:56px auto;background:white;border:1px solid #ddd;border-radius:16px;padding:30px;box-shadow:0 8px 30px #0000000d}
label{display:block;font-weight:650;margin:18px 0 7px}
input{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid #bbb;border-radius:8px;font:inherit}
button{margin-top:24px;padding:11px 16px;border:0;border-radius:8px;background:#111;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.muted{color:#666;font-size:.94rem;line-height:1.6}
code{background:#eee;padding:2px 5px;border-radius:4px}
</style>
</head>
<body>
<main class="card">
<h1>Skyward MCP setup</h1>
<p>This page is served only from <code>127.0.0.1</code>. For compatible classic SMS 2.0 deployments, your credentials are sent directly from this local process to your configured Skyward instance to create a session.</p>
<p class="muted">Your password is not persisted. The resulting Skyward session is stored locally with restrictive file permissions. If your district requires SSO, this form will stop rather than collect your identity provider credentials.</p>
<form method="post" action="/connect">
<label for="loginUrl">Skyward login URL</label>
<input id="loginUrl" name="loginUrl" required placeholder="https://skyward.example.net/scripts/wsisa.dll/WService=wsEAplus/seplog01.w">
<label for="username">Skyward username</label>
<input id="username" name="username" autocomplete="username" required>
<label for="password">Skyward password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Connect and save session</button>
</form>
</main>
</body>
</html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start local setup server.");
  }

  const url =
    "http://127.0.0.1:" + address.port + "/";
  process.stderr.write("Skyward MCP setup: " + url + "\n");
  openBrowser(url);
}
