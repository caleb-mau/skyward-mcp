<div align="center">

# skyward-mcp

**Unofficial self hosted Skyward MCP for students and educators.**

Connect ChatGPT, Claude, or another MCP client to the Skyward account that the person running the server is already authorized to use.

[![CI](https://github.com/caleb-mau/skyward-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/caleb-mau/skyward-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node.js-20%2B-339933?logo=node.js&logoColor=white)](package.json)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-MCP-111111)](https://modelcontextprotocol.io/)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcaleb-mau%2Fskyward-mcp&env=MCP_AUTH_TOKEN%2CSKYWARD_SESSION_B64)

</div>

## What this is

skyward-mcp is the MCP application layer built on top of [skyward-rest](https://github.com/caleb-mau/skyward-rest).

The split is intentional:

```text
skyward-rest
  typed Skyward client
  authenticated transport
  provider adapters
  safe parsers

skyward-mcp
  MCP tools
  local setup
  ChatGPT OAuth
  browser SSO
  role aware privacy
  future write approvals
```

The project is designed around **user hosted access**. It does not require a centrally registered Skyward OAuth application.

## Current status

The first release is deliberately read only.

Current tools:

| Tool | Purpose |
| --- | --- |
| `skyward_status` | Validate the current Skyward session and show redacted health, role, and provider status |
| `skyward_get_capabilities` | Show exactly what the active provider supports |
| `skyward_get_report_card` | Read report card grade data |
| `skyward_get_gradebook` | Read a detailed course gradebook |
| `skyward_get_academic_history` | Read academic history |
| `skyward_get_attendance` | Read attendance details and history |
| `skyward_get_schedule` | Read current schedule and course request tables |
| `skyward_get_test_scores` | Read test score tables |
| `skyward_get_fees` | Read fee and balance tables |
| `skyward_get_graduation_requirements` | Read graduation requirement tables |

The current `skyward-rest` SMS 2.0 provider implements the student read surfaces that have actually been rebuilt and tested from modern route discovery.

Teacher, parent, staff, Qmlativ, broader profile data, calendar event parsing, and SIS write support remain extension points rather than fake claims of support.

## Authentication model

There are two separate authentication layers.

```text
ChatGPT / Claude
        |
        | MCP authorization
        v
   skyward-mcp
        |
        | authenticated Skyward session
        v
      Skyward
```

### MCP authentication

Hosted mode uses `MCP_AUTH_TOKEN`.

ChatGPT can connect using the built in OAuth 2.1 compatibility flow with PKCE. The authorization page asks for the same `MCP_AUTH_TOKEN` configured on the deployment.

Other MCP clients may use that secret directly as a Bearer token.

### Skyward authentication

skyward-mcp supports browser SSO capture, local session files, hosted session secrets, and compatible classic SMS 2.0 native login.

The password path is only for Skyward deployments that still allow that login flow.

If the district requires SSO, skyward-mcp does **not** ask for Microsoft, Google, ClassLink, Clever, or other identity provider passwords.

Browser SSO is implemented locally with the intended architecture:

```text
real district browser login
        |
        | user completes SSO and MFA normally
        v
authenticated Skyward browser session
        |
        | imported into the self hosted instance
        v
SkywardSession
        |
        v
skyward-rest
```

Run `npm run setup:sso`. A temporary local Chrome, Edge, or Chromium profile opens to the real district login. Complete SSO and MFA normally. skyward-mcp ignores off origin identity provider traffic and waits until Skyward itself emits the resulting SMS session fields, then saves only the Skyward session locally.

## Local setup

Requirements:

* Node.js 20 or newer
* npm

```bash
git clone https://github.com/caleb-mau/skyward-mcp.git
cd skyward-mcp
npm install
npm run setup
```

The setup command opens a page on `127.0.0.1`.

For a compatible classic SMS 2.0 login, enter the Skyward login URL, username, and password. The local process authenticates directly with that Skyward instance and saves only the resulting session.

The password is not persisted.

### Browser SSO

For districts that use Microsoft, Google, ClassLink, Clever, SAML, or another browser based login:

```bash
npm run setup:sso
```

You can also provide the starting Skyward URL:

```bash
npm run setup -- --sso "https://skyward.example.net/"
```

The command opens an installed Chrome, Edge, or Chromium browser in a temporary profile. Complete the district login and MFA normally.

skyward-mcp only inspects requests whose origin matches the Skyward origin and only extracts the resulting Skyward session fields needed by skyward-rest. It does not store the identity provider password, SAML assertion, Microsoft token, Google token, or other off origin authentication traffic.

Once the complete Skyward session is observed, skyward-mcp validates it with a real Skyward request before saving it. If the captured session does not work outside the browser, setup fails instead of exporting a broken session.

The default session path is:

```text
~/.skyward-mcp/session.json
```

The file is written with restrictive permissions.

### Import an existing session

If another local browser flow produces a `SkywardSessionExport`:

```bash
npm run setup -- --import-session ./skyward-session.json
```

The session is validated through `skyward-rest` before it is saved.

## Run locally over stdio

```bash
npm run start:stdio
```

Example MCP configuration:

```json
{
  "mcpServers": {
    "skyward": {
      "command": "npm",
      "args": ["run", "start:stdio", "--silent"],
      "cwd": "/absolute/path/to/skyward-mcp"
    }
  }
}
```

## Deploy to Vercel

Vercel is the easiest hosted path.

First authenticate locally once. For a district using SSO:

```bash
git clone https://github.com/caleb-mau/skyward-mcp.git
cd skyward-mcp
npm install
npm run setup:sso
```

For a compatible native Skyward login, `npm run setup` is still available.

Then generate the two values Vercel needs:

```bash
npm run vercel:env
```

The command prints:

```text
MCP_AUTH_TOKEN=...
SKYWARD_SESSION_B64=...
```

Treat both values as secrets. `SKYWARD_SESSION_B64` is base64 encoding for safe copy and paste, not encryption.

Now use the one click deployment:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcaleb-mau%2Fskyward-mcp&env=MCP_AUTH_TOKEN%2CSKYWARD_SESSION_B64)

Paste those two values when Vercel asks for environment variables. Next.js is detected automatically and no database is required.

Your MCP endpoint will be:

```text
https://your-deployment.vercel.app/mcp
```

The hosted server also supports these alternatives:

| Variable | Required | Purpose |
| --- | :---: | --- |
| `MCP_AUTH_TOKEN` | hosted | Protects the remote MCP and backs the ChatGPT OAuth flow |
| `SKYWARD_SESSION_B64` | recommended hosted auth | Base64 encoded `SkywardSessionExport` |
| `MCP_PUBLIC_ORIGIN` |  | Optional canonical deployment origin |
| `SKYWARD_SESSION_JSON` | alternate hosted auth | Raw `SkywardSessionExport` JSON |
| `SKYWARD_SESSION_FILE` | server file auth | Path to a session file |
| `SKYWARD_LOGIN_URL` | classic login fallback | SMS 2.0 login URL |
| `SKYWARD_USERNAME` | classic login fallback | Native Skyward username |
| `SKYWARD_PASSWORD` | classic login fallback | Native Skyward password |
| `SKYWARD_TIMEOUT_MS` |  | Skyward request timeout, default 30000 |

Using a saved session is preferred over storing the Skyward password in Vercel.

A Skyward session can expire. Check the local copy at any time with:

```bash
npm run session:check
```

For an existing Vercel deployment, refresh only the Skyward session and keep the existing `MCP_AUTH_TOKEN` so ChatGPT OAuth stays connected:

```bash
npm run setup:sso
npm run session:check
npm run vercel:session
```

Replace only `SKYWARD_SESSION_B64` in Vercel, then redeploy. `npm run vercel:env` is intended for the initial deployment because it can generate a new MCP access token.

Interactive SSO runs locally rather than inside Vercel. After `npm run setup:sso` succeeds, run `npm run vercel:env` and deploy the resulting session exactly the same way as a native Skyward session. Vercel does not need to know whether the original login used Microsoft, Google, ClassLink, Clever, MFA, or native Skyward authentication.

## ChatGPT

Add the hosted `/mcp` URL and use OAuth.

The built in OAuth flow is separate from Skyward authentication. It only proves that the person connecting ChatGPT owns the self hosted MCP deployment.

The OAuth implementation supports:

* Authorization code flow
* PKCE S256
* ChatGPT CIMD client metadata
* Short lived access tokens
* Refresh tokens
* Deployment scoped resources

## Discover Skyward routes

Skyward installations vary by district, generation, role, and portal version. The local discovery recorder helps map the authenticated web traffic without exporting the underlying school records.

Run:

```bash
npm run discover
```

Or provide the initial Skyward URL directly:

```bash
npm run discover -- --url "https://skyward.example.net/scripts/wsisa.dll/WService=wsEAplus/seplog01.w"
```

The recorder:

* Opens installed Google Chrome, Microsoft Edge, or Chromium in a temporary profile
* Lets the user complete the district's real login, SSO, and MFA normally
* Captures only requests whose origin exactly matches the configured Skyward origin
* Ignores Microsoft, Google, ClassLink, Clever, and other off origin authentication traffic
* Records paths, HTTP methods, query field names, form field names, selected safe action constants, status codes, content types, table ID patterns, form structure, same origin links, and referenced Skyward endpoints
* Writes a machine readable `routes.json` and a human readable `routes.md`
* Deletes the temporary browser profile when discovery ends

The export intentionally does not write raw response bodies, response text, cookies, authorization headers, passwords, or raw session token values.

By default, files are written under:

```text
~/.skyward-mcp/discovery/<timestamp>/
```

When you are finished clicking through Skyward, return to the terminal and press Enter.

Useful options:

```text
--url URL
--capture-origin URL
--out PATH
--browser-path PATH
```

The exact origin restriction is deliberate. If a district starts on one hostname but the actual Skyward portal lives on another, pass the final Skyward portal origin with `--capture-origin`. Do not set an identity provider as the capture origin.

Even sanitized exports should be reviewed before they are shared or committed. The sanitizer is designed to remove record values while preserving protocol structure, but no automated redaction system should be treated as a guarantee against every district specific field.

## Privacy and safety

Skyward is an official student information system. The project treats its data accordingly.

The MCP does not expose:

* Skyward passwords
* Skyward cookies
* SMS session tokens
* Raw session exports

Normal status output contains only a redacted session summary and provider capabilities.

The current release contains no SIS write tools.

Read [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) before using real education records.

## Students and educators

The architecture is not student only.

`skyward-rest` models roles and capabilities for:

* Students
* Teachers
* Parents
* Staff

skyward-mcp uses capability discovery rather than assuming every authenticated identity has the same Skyward surface.

Teacher tools will be added when their actual Skyward endpoints and data structures are tested. Future teacher responses should minimize student identity data instead of exposing every field available to the underlying account.

## Relationship to Skyward

This is an unofficial open source project and is not affiliated with or endorsed by Skyward, Inc.

Users are responsible for complying with their district policies and only accessing records they are authorized to access.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Use fictional or heavily sanitized test data only.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
