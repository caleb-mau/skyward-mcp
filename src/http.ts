import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./server";
import { canonicalOrigin, validMcpBearer } from "./oauth";

const handler = createMcpHandler(() => createServer());

function bearerValue(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function handleRemoteMcp(
  request: Request,
): Promise<Response> {
  if (!process.env.MCP_AUTH_TOKEN?.trim()) {
    return Response.json(
      { error: "MCP_AUTH_TOKEN is not configured on this deployment." },
      { status: 503 },
    );
  }

  const origin = canonicalOrigin(request);
  const bearer = bearerValue(request.headers.get("authorization"));

  if (!bearer || !validMcpBearer(bearer, origin)) {
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer resource_metadata="' +
            origin +
            '/.well-known/oauth-protected-resource", scope="mcp", error="invalid_token"',
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return handler.fetch(request, {
    authInfo: {
      token: bearer,
      clientId: "oauth-or-self-hosted-client",
      scopes: ["mcp"],
    },
  });
}
