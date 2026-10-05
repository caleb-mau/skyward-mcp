# Privacy

skyward-mcp is designed around user hosted access to the Skyward account the operator is already authorized to use.

## What the project stores

The project does not require a student database.

Local mode may store an authenticated Skyward session in:

```text
~/.skyward-mcp/session.json
```

That file contains sensitive session state and is written with restrictive permissions.

Compatible native SMS 2.0 passwords are used for login but are not written to the local session file.

## What reaches the model

Only data returned by explicit MCP tools reaches the connected AI client.

The current tool surface is intentionally narrow and read only.

Authentication cookies, SMS session tokens, passwords, and the raw session export are not exposed through MCP tools.

## Teachers and other roles

The architecture supports student, teacher, parent, and staff role hints, but the current skyward-rest SMS 2.0 adapter only implements the read surfaces that have actually been rebuilt and tested.

Future teacher tools should minimize student identity data and should not expose entire rosters or sensitive demographic fields merely because the underlying account can access them.

## SSO

Identity provider credentials should stay inside the district's normal browser authentication flow.

Browser SSO support will import the resulting Skyward session into this self hosted application rather than forwarding Microsoft, Google, ClassLink, Clever, or other identity provider credentials to the model.
