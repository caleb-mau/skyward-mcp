const tools = [
  "Session status",
  "Capabilities",
  "Report cards",
  "Detailed gradebook",
  "Academic history",
  "Attendance",
  "Schedule",
  "Test scores",
  "Fees",
  "Graduation requirements",
];

export default function Home() {
  const configured = Boolean(
    process.env.MCP_AUTH_TOKEN &&
      (
        process.env.SKYWARD_SESSION_B64 ||
        process.env.SKYWARD_SESSION_JSON ||
        process.env.SKYWARD_SESSION_FILE ||
        (
          process.env.SKYWARD_LOGIN_URL &&
          process.env.SKYWARD_USERNAME &&
          process.env.SKYWARD_PASSWORD
        )
      )
  );

  return (
    <main className="shell">
      <section className="card">
        <div className="eyebrow">Skyward MCP</div>
        <h1>Your Skyward account, available over MCP.</h1>
        <p className="lead">
          An unofficial, self hosted bridge from AI clients to Skyward. The
          server uses the authenticated Skyward session that belongs to the
          person running it. It does not require a centrally registered
          Skyward OAuth application.
        </p>

        <div className="status">
          <span className={configured ? "dot ready" : "dot"} />
          <span>
            {configured
              ? "Hosted authentication appears configured."
              : "The server is running, but hosted Skyward authentication is not fully configured."}
          </span>
        </div>

        <div className="grid">
          <div>
            <h2>MCP endpoint</h2>
            <code>/mcp</code>
          </div>
          <div>
            <h2>ChatGPT authentication</h2>
            <code>OAuth 2.1 + PKCE, backed by MCP_AUTH_TOKEN</code>
          </div>
          <div>
            <h2>Skyward authentication</h2>
            <code>Self hosted session or compatible SMS 2.0 login</code>
          </div>
        </div>

        <h2>Current read only surface</h2>
        <div className="chips">
          {tools.map((tool) => (
            <span key={tool}>{tool}</span>
          ))}
        </div>

        <p className="foot">
          For Vercel, authenticate locally once and run <code>npm run vercel:env</code>.
          Paste the two generated secret values into the one click deploy flow.
          Browser based SSO now runs locally through <code>npm run setup:sso</code>,
          not in skyward-rest. The current release accepts imported Skyward
          sessions and classic SMS 2.0 login where supported. Teacher and write
          workflows will be added only after their real Skyward surfaces are
          tested safely.
        </p>
      </section>
    </main>
  );
}
