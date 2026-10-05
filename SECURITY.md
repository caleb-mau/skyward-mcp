# Security Policy

## Credentials and session data

Never post real Skyward usernames, passwords, cookies, session tokens, student records, teacher records, grades, attendance records, schedules, or other education records in a public issue.

If a credential or authenticated session is exposed, invalidate it using the district's normal process and sign in again.

## Authentication boundaries

skyward-mcp has two independent authentication layers.

The MCP layer controls which AI client may connect to the self hosted server.

The Skyward layer controls what the authenticated Skyward account may access.

The project does not attempt to bypass district SSO, MFA, or identity provider controls. Do not add code that collects Microsoft, Google, ClassLink, Clever, or other identity provider passwords.

Local browser SSO capture uses a temporary browser profile and inspects only requests back to the configured Skyward origin. Off origin identity provider traffic is ignored. The capture code extracts only the resulting Skyward session fields and Skyward cookies needed to create a SkywardSessionExport.

## Session storage

Local setup stores the resulting Skyward session with restrictive file permissions and does not persist the password used for compatible SMS 2.0 login.

For hosted deployments, session JSON and native login credentials are deployment secrets and should be treated like passwords.

## Network boundary

Authenticated Skyward requests are implemented by skyward-rest, which restricts authenticated requests to the configured Skyward origin.

## Route discovery

`npm run discover` is a local development recorder for reverse engineering the Skyward web interface the authenticated user can already access.

The recorder uses an exact Skyward origin allowlist. Traffic to SSO identity providers and other origins is ignored.

Raw browser traffic is processed only in memory long enough to derive structural metadata. The generated export does not intentionally contain raw response text, cookies, authorization headers, passwords, or session token values.

Request values that are not a small allowlisted protocol constant are replaced with stable local placeholders. HTML export keeps structure such as field names, form actions, endpoint references, table ID patterns, and data attribute names while discarding page text.

Do not weaken these rules for convenience. Never add a "raw HAR" option to the normal discovery command.

Always manually review a discovery export before sharing or committing it because district specific pages may expose unexpected field names or structures.

## Current write policy

The current MCP release is read only.

Do not add official SIS writes without separate tool surfaces, accurate MCP write annotations, role checks, tests, and explicit review of the real Skyward workflow being changed.

## Reporting

Use GitHub private vulnerability reporting when possible. Do not publish exploitable details or real education records in a public issue.
