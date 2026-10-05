import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  SkywardHttpError,
  SkywardSsoRequiredError,
  type SkywardClient,
} from "skyward-rest";
import {
  loadSkyward,
  redactedRuntimeConfig,
} from "./config";

export interface SkywardToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}

export function skywardToolAnnotations(
  _name: string,
): SkywardToolAnnotations {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
}

function ok(data: unknown, extra?: Record<string, unknown>) {
  const payload = extra ? { ...extra, data } : data;
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function fail(error: unknown) {
  if (error instanceof SkywardHttpError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: error.message,
              status: error.status,
              url: error.url,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  if (error instanceof SkywardSsoRequiredError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: error.message,
              code: "sso_required",
              guidance:
                "Authenticate through the district's normal browser SSO flow and import the resulting Skyward session into this self hosted MCP.",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error
          ? error.message
          : String(error),
      },
    ],
  };
}

function tool(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: z.ZodType,
  handler: (
    args: any,
    client: SkywardClient,
  ) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      annotations: skywardToolAnnotations(name),
      _meta: {
        securitySchemes: [
          { type: "oauth2", scopes: ["mcp"] },
        ],
      },
    },
    async (args) => {
      try {
        const { client } = await loadSkyward();
        return ok(await handler(args, client));
      } catch (error) {
        return fail(error);
      }
    },
  );
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "skyward-mcp", version: "0.1.0" },
    {
      instructions:
        "Skyward contains official student information system records. Treat all returned education records as sensitive. This release is read only. Never claim teacher write support or attendance write support unless the corresponding tool is actually available. Browser SSO setup runs locally outside the MCP tool surface. Authentication secrets and Skyward session tokens must never be exposed through MCP responses.",
    },
  );

  server.registerTool(
    "skyward_status",
    {
      description:
        "Show the configured Skyward session summary, authentication source, role hint, generation, and capabilities without exposing cookies, passwords, or session tokens.",
      inputSchema: z.object({}),
      annotations: skywardToolAnnotations("skyward_status"),
      _meta: {
        securitySchemes: [
          { type: "oauth2", scopes: ["mcp"] },
        ],
      },
    },
    async () => {
      try {
        return ok(await redactedRuntimeConfig(), {
          connected: true,
          read_only: true,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  tool(
    server,
    "skyward_get_capabilities",
    "Return the capabilities exposed by the active skyward-rest provider. Use this before assuming a student, teacher, parent, or staff workflow is supported.",
    z.object({}),
    async (_args, client) => {
      const info = client.capabilities();
      return {
        generation: info.generation,
        role: info.role,
        capabilities: [...info.capabilities],
      };
    },
  );

  tool(
    server,
    "skyward_get_report_card",
    "Read report card grade data visible to the authenticated Skyward user.",
    z.object({}),
    async (_args, client) => client.getReportCard(),
  );

  tool(
    server,
    "skyward_get_gradebook",
    "Read the detailed Skyward gradebook for one course and grading bucket. course_id and bucket normally come from report card links or other Skyward data.",
    z.object({
      course_id: z
        .union([z.string(), z.number()])
        .transform(String),
      bucket: z.string().min(1),
    }),
    async ({ course_id, bucket }, client) =>
      client.getGradebook({
        courseId: course_id,
        bucket,
      }),
  );

  tool(
    server,
    "skyward_get_academic_history",
    "Read the authenticated user's academic history as exposed by the active Skyward provider.",
    z.object({}),
    async (_args, client) => client.getAcademicHistory(),
  );

  tool(
    server,
    "skyward_get_attendance",
    "Read the authenticated student's Skyward attendance tables, including current attendance details and attendance history when available.",
    z.object({}),
    async (_args, client) => client.getAttendance(),
  );

  tool(
    server,
    "skyward_get_schedule",
    "Read the authenticated student's current Skyward schedule and course request tables when available.",
    z.object({}),
    async (_args, client) => client.getSchedule(),
  );

  tool(
    server,
    "skyward_get_test_scores",
    "Read test score tables visible to the authenticated student in Skyward.",
    z.object({}),
    async (_args, client) => client.getTestScores(),
  );

  tool(
    server,
    "skyward_get_fees",
    "Read the authenticated student's Skyward fee and current balance tables.",
    z.object({}),
    async (_args, client) => client.getFees(),
  );

  tool(
    server,
    "skyward_get_graduation_requirements",
    "Read graduation requirement and course requirement tables visible to the authenticated student in Skyward.",
    z.object({}),
    async (_args, client) =>
      client.getGraduationRequirements(),
  );

  return server;
}
