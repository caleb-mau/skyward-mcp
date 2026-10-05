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
