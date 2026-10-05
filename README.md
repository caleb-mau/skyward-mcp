<div align="center">

# skyward-mcp

**Unofficial self hosted Skyward MCP for students and educators.**

Connect ChatGPT, Claude, or another MCP client to the Skyward account that the person running the server is already authorized to use.

[![CI](https://github.com/caleb-mau/skyward-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/caleb-mau/skyward-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node.js-20%2B-339933?logo=node.js&logoColor=white)](package.json)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-MCP-111111)](https://modelcontextprotocol.io/)

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
  future browser SSO
  role aware privacy
  future write approvals
```

The project is designed around **user hosted access**. It does not require a centrally registered Skyward OAuth application.

## Current status

The first release is deliberately read only.

Current tools:

| Tool | Purpose |
| --- | --- |
| `skyward_status` | Show redacted session and provider status |
| `skyward_get_capabilities` | Show exactly what the active provider supports |
| `skyward_get_report_card` | Read report card grade data |
| `skyward_get_gradebook` | Read a detailed course gradebook |
| `skyward_get_academic_history` | Read academic history |

The current `skyward-rest` SMS 2.0 provider implements the student read surfaces that have actually been rebuilt and tested.

Teacher, parent, staff, Qmlativ, schedule, attendance, and SIS write support are extension points, not fake claims of support.

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

skyward-mcp supports three session sources:

1. A local session file
2. `SKYWARD_SESSION_JSON`
3. Compatible classic SMS 2.0 username and password environment variables

The password path is only for Skyward deployments that still allow that login flow.

If the district requires SSO, skyward-mcp does **not** ask for Microsoft, Google, ClassLink, Clever, or other identity provider passwords.

The intended SSO architecture is:

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

The current server can already import a `SkywardSessionExport`. Interactive browser capture will be added on top of that boundary rather than changing the core architecture.

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

## Hosted mode

The remote endpoint is:

```text
https://your-deployment.example/mcp
```

Environment variables:

| Variable | Required | Purpose |
| --- | :---: | --- |
| `MCP_AUTH_TOKEN` | hosted | Protects the remote MCP and backs the ChatGPT OAuth flow |
| `MCP_PUBLIC_ORIGIN` |  | Optional canonical deployment origin |
| `SKYWARD_SESSION_JSON` | one Skyward auth source | Complete `SkywardSessionExport` JSON |
| `SKYWARD_SESSION_FILE` | one Skyward auth source | Path to a session file |
| `SKYWARD_LOGIN_URL` | classic login | SMS 2.0 login URL |
| `SKYWARD_USERNAME` | classic login | Native Skyward username |
| `SKYWARD_PASSWORD` | classic login | Native Skyward password |
| `SKYWARD_TIMEOUT_MS` |  | Skyward request timeout, default 30000 |

Hosted SSO is intentionally not presented as solved yet. Durable browser sessions and reauthentication need a design appropriate for the deployment environment.

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
