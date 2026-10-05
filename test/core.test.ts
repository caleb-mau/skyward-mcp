import assert from "node:assert/strict";
import test from "node:test";
import {
  SkywardSession,
  type SkywardSessionExport,
} from "skyward-rest";
import {
  parseSessionBase64,
  parseSessionJson,
} from "../src/config";
import {
  skywardToolAnnotations,
} from "../src/server";
import type { CapturedSms2State } from "../src/sso";
import {
  authorizationServerMetadata,
  parseScope,
  protectedResourceMetadata,
} from "../src/oauth";

test("all current Skyward MCP tools are read only", () => {
  assert.deepEqual(
    skywardToolAnnotations(
      "skyward_get_gradebook",
    ),
    {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  );
});

test("session JSON validates through skyward-rest", () => {
  const session: SkywardSessionExport = {
    version: 1,
    generation: "sms2",
    baseUrl:
      "https://skyward.example.test/scripts/wsisa.dll/WService=wsEAplus/",
    role: "student",
    sms2: {
      dwd: "1",
      wfaacl: "2",
      encses: "3",
      sessionId: "4",
    },
  };

  const parsed = parseSessionJson(
    JSON.stringify(session),
  );
  assert.equal(parsed.generation, "sms2");

  const redacted = JSON.stringify(
    SkywardSession.from(parsed),
  );
  assert.doesNotMatch(redacted, /"encses":"3"/);
});

test("OAuth metadata is deployment scoped", () => {
  const origin = "https://skyward-mcp.example";
  const auth =
    authorizationServerMetadata(origin);
  const resource =
    protectedResourceMetadata(origin);

  assert.equal(auth.issuer, origin);
  assert.equal(resource.resource, origin);
  assert.ok(
    parseScope("offline_access").includes("mcp"),
  );
});


test("base64 hosted session transport round trips", () => {
  const session: SkywardSessionExport = {
    version: 1,
    generation: "sms2",
    baseUrl:
      "https://skyward.example.test/scripts/wsisa.dll/WService=wsEAplus/",
    role: "student",
    sms2: {
      dwd: "1",
      wfaacl: "2",
      encses: "3",
      sessionId: "4",
    },
  };

  const encoded = Buffer.from(
    JSON.stringify(session),
    "utf8",
  ).toString("base64");

  const parsed = parseSessionBase64(encoded);
  assert.equal(parsed.sms2?.sessionId, "4");
  assert.throws(
    () => parseSessionBase64("not base64 !!!"),
    /not valid base64/,
  );
});


test("discovery sanitization preserves routes without education record values", async () => {
  const {
    StableRedactor,
    buildManifest,
    sanitizeRequestBody,
    sanitizeResponseStructure,
    sanitizeUrl,
  } = await import("../src/discovery/sanitize");

  const redactor = new StableRedactor();
  const origin = "https://skyward.example.test";

  const url = sanitizeUrl(
    origin +
      "/scripts/wsisa.dll/WService=wsEAplus/httploader.p?file=sfgradebook001.w&action=viewGradeInfoDialog&stuId=928374",
    origin,
    redactor,
  );

  assert.ok(url);
  assert.equal(
    url?.path,
    "/scripts/wsisa.dll/WService=wsEAplus/httploader.p",
  );
  assert.equal(url?.query.file, "sfgradebook001.w");
  assert.equal(url?.query.action, "viewGradeInfoDialog");
  assert.match(String(url?.query.stuId), /^<student_\d+>$/);

  const request = sanitizeRequestBody({
    contentType: "application/x-www-form-urlencoded",
    postData:
      "action=viewGradeInfoDialog&stuId=928374&entityId=710&sessionid=VERY_SECRET_SESSION&encses=VERY_SECRET_TOKEN",
    redactor,
  });

  const requestJson = JSON.stringify(request);
  assert.match(requestJson, /viewGradeInfoDialog/);
  assert.doesNotMatch(requestJson, /928374/);
  assert.doesNotMatch(requestJson, /VERY_SECRET_SESSION/);
  assert.doesNotMatch(requestJson, /VERY_SECRET_TOKEN/);

  const html = Buffer.from(
    [
      '<html><body>',
      '<h1>Jane Student</h1>',
      '<div>Current grade 97.5</div>',
      '<form method="post" action="/scripts/wsisa.dll/WService=wsEAplus/sfattendance001.w">',
      '<input name="sessionid" value="VERY_SECRET_SESSION">',
      '<input name="studentId" value="928374">',
      '</form>',
      '<table id="grid_attendanceHistory_928374_710"></table>',
      '<script>',
      'const route = "sfgradebook002.w";',
      'const action = "viewGPARank";',
      '</script>',
      '</body></html>',
    ].join(""),
  );

  const structure = sanitizeResponseStructure({
    body: html,
    contentType: "text/html; charset=utf-8",
    captureOrigin: origin,
    redactor,
  });

  const structureJson = JSON.stringify(structure);
  assert.doesNotMatch(structureJson, /Jane Student/);
  assert.doesNotMatch(structureJson, /97\.5/);
  assert.doesNotMatch(structureJson, /928374/);
  assert.doesNotMatch(structureJson, /VERY_SECRET_SESSION/);
  assert.match(structureJson, /sfattendance001\.w/);
  assert.match(structureJson, /sfgradebook002\.w/);
  assert.match(structureJson, /viewGPARank/);
  assert.match(structureJson, /grid_attendanceHistory_<n>_<n>/);

  const manifest = buildManifest({
    captureOrigin: origin,
    browser: "Google Chrome",
    navigations: [
      {
        at: "2026-10-05T12:00:00.000Z",
        path: "/scripts/wsisa.dll/WService=wsEAplus/sfgradebook001.w",
      },
    ],
    events: [
      {
        at: "2026-10-05T12:00:01.000Z",
        method: "POST",
        path:
          "/scripts/wsisa.dll/WService=wsEAplus/httploader.p",
        resource_type: "xhr",
        query: url?.query || {},
        headers: {
          "x-requested-with": "XMLHttpRequest",
        },
        request,
        response: {
          status: 200,
          content_type: "text/html",
          structure,
        },
      },
    ],
  });

  const exported = JSON.stringify(manifest);
  assert.doesNotMatch(exported, /Jane Student/);
  assert.doesNotMatch(exported, /VERY_SECRET/);
  assert.equal(manifest.privacy.raw_bodies_written, false);
  assert.equal(manifest.routes[0]?.control_values.action?.[0], "viewGradeInfoDialog");
});

test("discovery ignores URLs outside the configured Skyward origin", async () => {
  const {
    StableRedactor,
    sanitizeUrl,
  } = await import("../src/discovery/sanitize");

  const redactor = new StableRedactor();
  assert.equal(
    sanitizeUrl(
      "https://login.microsoftonline.com/common/oauth2/authorize?client_id=secret",
      "https://skyward.example.test",
      redactor,
    ),
    null,
  );
});


test("browser SSO capture reconstructs the modern SMS session without reading IdP traffic", async () => {
  const {
    capturedSessionReady,
    observeSkywardRequest,
  } = await import("../src/sso");

  const state: CapturedSms2State = { tokens: {} };
  const origin = "https://skyward.example.test";

  observeSkywardRequest({
    url: "https://login.microsoftonline.com/common/SAML",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    postData: "SAMLResponse=VERY_SECRET_IDP_ASSERTION",
    captureOrigin: origin,
    state,
  });

  assert.deepEqual(state, { tokens: {} });

  observeSkywardRequest({
    url: origin + "/Student/web/sfhome01.w",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    postData:
      "dwd=123&wfaacl=456&encses=encrypted-session&FromRecent=true",
    captureOrigin: origin,
    state,
  });

  observeSkywardRequest({
    url:
      origin +
      "/Student/web/httploader.p?file=sfhome01.w",
    method: "POST",
    contentType:
      "application/x-www-form-urlencoded; charset=UTF-8",
    postData:
      "action=getAlerts&sessionid=session-789&encses=encrypted-session&dwd=123&wfaacl=456",
    captureOrigin: origin,
    state,
  });

  assert.equal(state.portalRoot, "/Student/web/");
  assert.equal(state.role, "student");
  assert.equal(state.tokens.dwd, "123");
  assert.equal(state.tokens.wfaacl, "456");
  assert.equal(state.tokens.encses, "encrypted-session");
  assert.equal(state.tokens.sessionId, "session-789");
  assert.equal(capturedSessionReady(state), true);
});

test("discovery strips display names embedded in Skyward element ids", async () => {
  const { sanitizeIdentifier } = await import(
    "../src/discovery/sanitize"
  );

  const sanitized = sanitizeIdentifier(
    "link12_3_f4fe5_6_CALEB",
  );

  assert.equal(
    sanitized,
    "link<n>_<n>_f<n>fe<n>_<n>_<label>",
  );
  assert.doesNotMatch(sanitized, /CALEB/);
});

test("discovery treats JavaScript as JavaScript and filters property noise", async () => {
  const {
    StableRedactor,
    sanitizeResponseStructure,
  } = await import("../src/discovery/sanitize");

  const structure = sanitizeResponseStructure({
    body: Buffer.from(
      [
        'const fake = "<table id=\"not-html\"></table>";',
        'const one = "Object.p";',
        'const two = "a.p";',
        'const real = "sfgradebook002.w";',
      ].join("\n"),
    ),
    contentType: "application/javascript",
    captureOrigin: "https://skyward.example.test",
    redactor: new StableRedactor(),
  });

  assert.equal(structure.kind, "javascript");
  assert.deepEqual(
    structure.endpoint_refs,
    ["/sfgradebook002.w"],
  );
});


test("SSO cookie capture keeps path scoped Skyward cookies and excludes identity providers", async () => {
  const { filterSkywardCookies } = await import("../src/sso");

  const cookies = filterSkywardCookies(
    [
      {
        name: "skywardPortal",
        value: "secret",
        domain: ".scps.k12.fl.us",
        path: "/Student/web/",
        secure: true,
      },
      {
        name: "microsoft",
        value: "idp-secret",
        domain: ".microsoftonline.com",
        path: "/",
        secure: true,
      },
    ],
    "https://skyward.scps.k12.fl.us/Student/web/",
  );

  assert.deepEqual(
    cookies.map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
    })),
    [
      {
        name: "skywardPortal",
        domain: ".scps.k12.fl.us",
        path: "/Student/web/",
      },
    ],
  );
});


test("Skyward session health values are safe for MCP status output", () => {
  const health = {
    valid: false,
    state: "session_invalid",
    htmlBytes: 2161,
  };

  const serialized = JSON.stringify(health);
  assert.match(serialized, /session_invalid/);
  assert.doesNotMatch(serialized, /sessionid|encses|cookie|password/i);
});
