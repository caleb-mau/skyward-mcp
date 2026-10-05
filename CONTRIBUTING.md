# Contributing

## Development

Requirements:

* Node.js 20 or newer
* npm

Run:

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Test data

Use fictional or heavily sanitized Skyward data only.

Never commit credentials, session exports, student records, teacher records, grades, attendance data, schedules, or other real education records.

## Architecture

Keep MCP behavior in this repository and Skyward parsing or transport behavior in skyward-rest.

If a change belongs to the reusable Skyward client, make it in skyward-rest first.

## Authentication

Do not bypass SSO or MFA.

Browser SSO should use the district's real authentication flow and import only the resulting Skyward session state.

## Writes

The current server is read only.

Any future SIS write tool must have a dedicated narrowly scoped tool, accurate MCP annotations, role checks, sanitized tests, and documentation of the consequence of the write.
