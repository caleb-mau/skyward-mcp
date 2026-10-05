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
