import { load } from "cheerio";
import type {
  DiscoveryEvent,
  DiscoveryManifest,
  DiscoveryNavigation,
  DiscoveryRouteSummary,
  SanitizedResponseStructure,
} from "./types";

const CONTROL_KEYS = new Set([
  "action",
  "requestaction",
  "codetype",
  "file",
  "mode",
  "view",
  "tab",
  "format",
  "sort",
  "requesttype",
]);

const SAFE_LITERAL = /^(?:true|false|yes|no|on|off|null|none)$/i;
const SAFE_CONTROL_VALUE = /^[A-Za-z][A-Za-z0-9_.:-]{0,100}$/;
const MAX_LIST = 200;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function limit<T>(values: T[], max = MAX_LIST): T[] {
  return values.slice(0, max);
}

export class StableRedactor {
  readonly #maps = new Map<string, Map<string, string>>();

  placeholder(key: string, value: string): string {
    const category = this.category(key);
    let map = this.#maps.get(category);
    if (!map) {
      map = new Map();
      this.#maps.set(category, map);
    }

    const existing = map.get(value);
    if (existing) return existing;

    const next = `<${category}_${map.size + 1}>`;
    map.set(value, next);
    return next;
  }

  category(key: string): string {
    const normalized = key.toLowerCase();
    if (/student|stu|nameid/.test(normalized)) return "student";
    if (/teacher|staff|user|person/.test(normalized)) return "user";
    if (/entity/.test(normalized)) return "entity";
    if (/course|class|cornum/.test(normalized)) return "course";
    if (/section/.test(normalized)) return "section";
    if (/gradebook|gbid/.test(normalized)) return "gradebook";
    if (/bucket|term/.test(normalized)) return "term";
    if (/email/.test(normalized)) return "email";
    if (/date|year/.test(normalized)) return "date";
    if (/(?:^|[_-])id$|recid/.test(normalized)) return "id";
    return "value";
  }
}

export function sanitizeIdentifier(value: string): string {
  let sanitized = value
    .replace(/[A-Fa-f0-9]{24,}/g, "<token>")
    .replace(/\d+/g, "<n>");

  // Some Skyward district-link IDs include the signed-in display name.
  // Keep the structural prefix while discarding that free-form suffix.
  sanitized = sanitized.replace(
    /^(link<n>_<n>_[^_]+_<n>_)[A-Za-z][A-Za-z' -]{1,80}$/i,
    "$1<label>",
  );

  return sanitized.slice(0, 180);
}

export function sanitizeScalar(
  key: string,
  value: string,
  redactor: StableRedactor,
): string {
  const normalizedKey = key.toLowerCase();

  if (SAFE_LITERAL.test(value)) return value.toLowerCase();

  if (
    CONTROL_KEYS.has(normalizedKey) &&
    SAFE_CONTROL_VALUE.test(value)
  ) {
    return value;
  }

  if (
    normalizedKey === "file" &&
    /^[A-Za-z0-9_.-]+\.(?:w|p)$/i.test(value)
  ) {
    return value;
  }

  return redactor.placeholder(key, value);
}

export function sanitizeUrl(
  raw: string,
  captureOrigin: string,
  redactor: StableRedactor,
): {
  path: string;
  query: Record<string, unknown>;
} | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.origin !== captureOrigin) return null;

  const query: Record<string, unknown> = {};
  for (const key of unique([...url.searchParams.keys()])) {
    const values = url.searchParams.getAll(key).map((value) =>
      sanitizeScalar(key, value, redactor),
    );
    query[key] = values.length === 1 ? values[0] : values;
  }

  return {
    path: url.pathname || "/",
    query,
  };
}

function sanitizeJsonValue(
  value: unknown,
  redactor: StableRedactor,
  key = "value",
  depth = 0,
): unknown {
  if (depth > 5) return "<max_depth>";

  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return redactor.placeholder(key, String(value));
  }
  if (typeof value === "string") {
    return sanitizeScalar(key, value, redactor);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) =>
      sanitizeJsonValue(entry, redactor, key, depth + 1),
    );
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    ).slice(0, 100)) {
      output[childKey] = sanitizeJsonValue(
        childValue,
        redactor,
        childKey,
        depth + 1,
      );
    }
    return output;
  }

  return `<${typeof value}>`;
}

export function sanitizeRequestBody(args: {
  contentType?: string;
  postData?: string | null;
  redactor: StableRedactor;
}): {
  content_type?: string;
  fields?: Record<string, unknown>;
  body_kind?: "form" | "json" | "multipart" | "text" | "none";
} {
  const contentType = (args.contentType || "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  const postData = args.postData || "";

  if (!postData) {
    return {
      ...(contentType ? { content_type: contentType } : {}),
      body_kind: "none",
    };
  }

  if (contentType === "application/x-www-form-urlencoded") {
    const fields: Record<string, unknown> = {};
    const params = new URLSearchParams(postData);
    for (const key of unique([...params.keys()])) {
      const values = params.getAll(key).map((value) =>
        sanitizeScalar(key, value, args.redactor),
      );
      fields[key] = values.length === 1 ? values[0] : values;
    }
    return {
      content_type: contentType,
      body_kind: "form",
      fields,
    };
  }

  if (contentType === "application/json" || contentType.endsWith("+json")) {
    try {
      const parsed = JSON.parse(postData);
      const sanitized = sanitizeJsonValue(
        parsed,
        args.redactor,
      );
      return {
        content_type: contentType,
        body_kind: "json",
        fields:
          sanitized &&
          typeof sanitized === "object" &&
          !Array.isArray(sanitized)
            ? sanitized as Record<string, unknown>
            : { value: sanitized },
      };
    } catch {
      return {
        content_type: contentType,
        body_kind: "text",
      };
    }
  }

  if (contentType.startsWith("multipart/form-data")) {
    return {
      content_type: contentType,
      body_kind: "multipart",
    };
  }

  return {
    ...(contentType ? { content_type: contentType } : {}),
    body_kind: "text",
  };
}

function extractEndpointRefs(
  text: string,
  captureOrigin: string,
  redactor: StableRedactor,
): string[] {
  const found = new Set<string>();
  const endpointPattern =
    /(?:https?:\/\/[^\s"'<>]+|(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:w|p)(?:\?[^\s"'<>]*)?)/g;

  const looksLikeSkywardProgram = (raw: string): boolean => {
    let pathname = raw;
    try {
      pathname = /^https?:\/\//i.test(raw)
        ? new URL(raw).pathname
        : new URL(raw, captureOrigin + "/").pathname;
    } catch {
      return false;
    }

    const parts = pathname.split("/").filter(Boolean);
    const base = parts.at(-1) || "";

    if (
      /^(?:q|sf|sep|sem|ssm|ssp|shr|sky|http|mobile|quick|upload|security|browser|browse|fw|usr|save|fc)[a-z0-9_-]*\.(?:w|p)$/i.test(
        base,
      )
    ) {
      return true;
    }

    return (
      parts.some((part) => part.toLowerCase() === "student") &&
      /^1[a-z0-9_-]{4,}\.(?:w|p)$/i.test(base)
    );
  };

  for (const match of text.matchAll(endpointPattern)) {
    const raw = match[0];
    if (!looksLikeSkywardProgram(raw)) continue;
    let value = raw;

    try {
      if (/^https?:\/\//i.test(raw)) {
        const parsed = sanitizeUrl(raw, captureOrigin, redactor);
        if (!parsed) continue;
        value = parsed.path;
        const keys = Object.keys(parsed.query);
        if (keys.length) value += "?" + keys.sort().join("&");
      } else {
        const synthetic = new URL(raw, captureOrigin + "/");
        if (synthetic.origin !== captureOrigin) continue;
        value = synthetic.pathname;
        const keys = unique([...synthetic.searchParams.keys()]);
        if (keys.length) value += "?" + keys.sort().join("&");
      }
    } catch {
      continue;
    }

    found.add(value);
    if (found.size >= MAX_LIST) break;
  }

  return [...found];
}

function extractActionRefs(text: string): string[] {
  const output = new Set<string>();
  const pattern =
    /(?:action|requestAction|codeType)\s*[:=]\s*["']([A-Za-z][A-Za-z0-9_.:-]{0,100})["']/gi;

  for (const match of text.matchAll(pattern)) {
    if (match[1]) output.add(match[1]);
    if (output.size >= MAX_LIST) break;
  }

  return [...output];
}

function sanitizeDomUrl(
  value: string | undefined,
  captureOrigin: string,
  redactor: StableRedactor,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, captureOrigin + "/");
    const parsed = sanitizeUrl(url.toString(), captureOrigin, redactor);
    if (!parsed) return undefined;
    const keys = Object.keys(parsed.query);
    return parsed.path + (keys.length ? "?" + keys.sort().join("&") : "");
  } catch {
    return undefined;
  }
}

function htmlStructure(
  html: string,
  captureOrigin: string,
  redactor: StableRedactor,
): SanitizedResponseStructure {
  const $ = load(html);

  const forms = $("form")
    .map((_index, element) => {
      const form = $(element);
      const action = sanitizeDomUrl(
        form.attr("action"),
        captureOrigin,
        redactor,
      );

      return {
        method: (form.attr("method") || "GET").toUpperCase(),
        ...(action ? { action } : {}),
        input_names: limit(
          unique(
            form
              .find("input[name]")
              .map((_i, input) => $(input).attr("name") || "")
              .get()
              .filter(Boolean),
          ),
        ),
        select_names: limit(
          unique(
            form
              .find("select[name]")
              .map((_i, input) => $(input).attr("name") || "")
              .get()
              .filter(Boolean),
          ),
        ),
        textarea_names: limit(
          unique(
            form
              .find("textarea[name]")
              .map((_i, input) => $(input).attr("name") || "")
              .get()
              .filter(Boolean),
          ),
        ),
      };
    })
    .get()
    .slice(0, 100);

  const tableIds = limit(
    unique(
      $("table[id]")
        .map((_index, element) =>
          sanitizeIdentifier($(element).attr("id") || ""),
        )
        .get()
        .filter(Boolean),
    ),
  );

  const elementIds = limit(
    unique(
      $("[id]")
        .map((_index, element) =>
          sanitizeIdentifier($(element).attr("id") || ""),
        )
        .get()
        .filter(Boolean),
    ),
  );

  const dataAttributes = new Set<string>();
  $("[data-rel], [data-action], [data-url], [data-id], [data-eid], [data-cni], [data-bkt]")
    .each((_index, element) => {
      for (const key of Object.keys(element.attribs || {})) {
        if (key.startsWith("data-")) dataAttributes.add(key);
      }
    });

  const sameOriginLinks = new Set<string>();
  $("[href], [src], form[action]").each((_index, element) => {
    const value =
      $(element).attr("href") ||
      $(element).attr("src") ||
      $(element).attr("action");
    const sanitized = sanitizeDomUrl(
      value,
      captureOrigin,
      redactor,
    );
    if (sanitized) sameOriginLinks.add(sanitized);
  });

  return {
    kind: "html",
    forms,
    table_ids: tableIds,
    element_ids: elementIds,
    data_attributes: limit([...dataAttributes].sort()),
    same_origin_links: limit([...sameOriginLinks].sort()),
    endpoint_refs: extractEndpointRefs(
      html,
      captureOrigin,
      redactor,
    ),
    action_refs: extractActionRefs(html),
  };
}

function jsonShape(value: unknown, depth = 0): unknown {
  if (depth > 6) return "<max_depth>";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.length
      ? [jsonShape(value[0], depth + 1)]
      : [];
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    ).slice(0, 100)) {
      output[key] = jsonShape(child, depth + 1);
    }
    return output;
  }
  return typeof value;
}

export function sanitizeResponseStructure(args: {
  body: Buffer;
  contentType?: string;
  captureOrigin: string;
  redactor: StableRedactor;
}): SanitizedResponseStructure {
  const contentType = (args.contentType || "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();

  const textLike =
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript");

  if (!textLike) return { kind: "binary" };

  const text = args.body.toString("utf8");

  if (contentType.includes("json")) {
    try {
      return {
        kind: "json",
        json_shape: jsonShape(JSON.parse(text)),
      };
    } catch {
      return { kind: "text" };
    }
  }

  if (
    !contentType.includes("javascript") &&
    !contentType.includes("ecmascript") &&
    (
      contentType.includes("html") ||
      /<html|<form|<table|<!doctype/i.test(text)
    )
  ) {
    return htmlStructure(
      text,
      args.captureOrigin,
      args.redactor,
    );
  }

  if (contentType.includes("xml") || /^\s*<\?xml/i.test(text)) {
    const tags = limit(
      unique(
        [...text.matchAll(/<([A-Za-z][A-Za-z0-9:_-]*)\b/g)]
          .map((match) => match[1] || "")
          .filter(Boolean),
      ),
    );

    const cdata = [...text.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)]
      .map((match) => match[1] || "")
      .join("\n");

    const embedded =
      cdata && /<html|<form|<table|<div|<span/i.test(cdata)
        ? htmlStructure(
            cdata,
            args.captureOrigin,
            args.redactor,
          )
        : undefined;

    return {
      kind: "xml",
      xml_tags: tags,
      endpoint_refs: unique([
        ...extractEndpointRefs(
          text,
          args.captureOrigin,
          args.redactor,
        ),
        ...(embedded?.endpoint_refs || []),
      ]),
      action_refs: unique([
        ...extractActionRefs(text),
        ...(embedded?.action_refs || []),
      ]),
      ...(embedded?.forms ? { forms: embedded.forms } : {}),
      ...(embedded?.table_ids
        ? { table_ids: embedded.table_ids }
        : {}),
      ...(embedded?.element_ids
        ? { element_ids: embedded.element_ids }
        : {}),
      ...(embedded?.data_attributes
        ? { data_attributes: embedded.data_attributes }
        : {}),
      ...(embedded?.same_origin_links
        ? { same_origin_links: embedded.same_origin_links }
        : {}),
    };
  }

  if (
    contentType.includes("javascript") ||
    contentType.includes("ecmascript")
  ) {
    return {
      kind: "javascript",
      endpoint_refs: extractEndpointRefs(
        text,
        args.captureOrigin,
        args.redactor,
      ),
      action_refs: extractActionRefs(text),
    };
  }

  return {
    kind: "text",
    endpoint_refs: extractEndpointRefs(
      text,
      args.captureOrigin,
      args.redactor,
    ),
    action_refs: extractActionRefs(text),
  };
}

function flattenKeys(
  value: Record<string, unknown> | undefined,
): string[] {
  return value ? Object.keys(value) : [];
}

function collectControlValues(
  event: DiscoveryEvent,
): Record<string, string[]> {
  const output: Record<string, string[]> = {};

  const visit = (fields: Record<string, unknown> | undefined) => {
    if (!fields) return;
    for (const [key, value] of Object.entries(fields)) {
      if (!CONTROL_KEYS.has(key.toLowerCase())) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        if (typeof entry !== "string") continue;
        if (!SAFE_CONTROL_VALUE.test(entry)) continue;
        (output[key] ||= []).push(entry);
      }
    }
  };

  visit(event.query);
  visit(event.request.fields);

  for (const key of Object.keys(output)) {
    output[key] = unique(output[key] || []).sort();
  }

  return output;
}

export function buildRouteSummaries(
  events: DiscoveryEvent[],
): DiscoveryRouteSummary[] {
  const groups = new Map<string, DiscoveryEvent[]>();

  for (const event of events) {
    const key = event.path;
    const group = groups.get(key) || [];
    group.push(event);
    groups.set(key, group);
  }

  const routes: DiscoveryRouteSummary[] = [];

  for (const [path, group] of groups) {
    const controls: Record<string, string[]> = {};

    for (const event of group) {
      const values = collectControlValues(event);
      for (const [key, items] of Object.entries(values)) {
        controls[key] = unique([
          ...(controls[key] || []),
          ...items,
        ]).sort();
      }
    }

    routes.push({
      path,
      methods: unique(group.map((event) => event.method)).sort(),
      count: group.length,
      resource_types: unique(
        group.map((event) => event.resource_type),
      ).sort(),
      statuses: unique(
        group
          .map((event) => event.response?.status)
          .filter((value): value is number => value !== undefined),
      ).sort((a, b) => a - b),
      content_types: unique(
        group
          .map((event) => event.response?.content_type || "")
          .filter(Boolean),
      ).sort(),
      query_keys: unique(
        group.flatMap((event) =>
          flattenKeys(event.query),
        ),
      ).sort(),
      request_fields: unique(
        group.flatMap((event) =>
          flattenKeys(event.request.fields),
        ),
      ).sort(),
      control_values: controls,
      endpoint_refs: unique(
        group.flatMap(
          (event) =>
            event.response?.structure?.endpoint_refs || [],
        ),
      ).sort(),
      action_refs: unique(
        group.flatMap(
          (event) =>
            event.response?.structure?.action_refs || [],
        ),
      ).sort(),
      table_ids: unique(
        group.flatMap(
          (event) =>
            event.response?.structure?.table_ids || [],
        ),
      ).sort(),
      form_actions: unique(
        group.flatMap((event) =>
          (event.response?.structure?.forms || [])
            .map((form) => form.action || "")
            .filter(Boolean),
        ),
      ).sort(),
    });
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

export function buildManifest(args: {
  captureOrigin: string;
  browser: string;
  events: DiscoveryEvent[];
  navigations: DiscoveryNavigation[];
}): DiscoveryManifest {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    capture_origin: args.captureOrigin,
    browser: args.browser,
    privacy: {
      raw_bodies_written: false,
      cookies_written: false,
      authorization_headers_written: false,
      response_text_written: false,
      note:
        "The recorder keeps raw traffic only in memory long enough to derive structural metadata. The export contains routes, field names, safe control constants, stable placeholders, and response structure, not raw education records or authentication secrets.",
    },
    navigations: args.navigations,
    routes: buildRouteSummaries(args.events),
    events: args.events,
  };
}

function mdEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function manifestMarkdown(
  manifest: DiscoveryManifest,
): string {
  const lines = [
    "# Skyward route discovery",
    "",
    `Generated: ${manifest.generated_at}`,
    "",
    `Capture origin: \`${manifest.capture_origin}\``,
    "",
    "This export is sanitized. It intentionally excludes raw response text, cookies, authorization headers, passwords, and session token values.",
    "",
    "## Routes",
    "",
    "| Path | Methods | Count | Status | Request fields | Controls |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];

  for (const route of manifest.routes) {
    const controls = Object.entries(route.control_values)
      .map(([key, values]) => `${key}=${values.join(",")}`)
      .join("; ");

    lines.push(
      `| ${mdEscape(route.path)} | ${route.methods.join(", ")} | ${route.count} | ${route.statuses.join(", ")} | ${mdEscape(route.request_fields.join(", "))} | ${mdEscape(controls)} |`,
    );
  }

  lines.push("", "## Discovered endpoint references", "");

  const refs = unique(
    manifest.routes.flatMap((route) => route.endpoint_refs),
  ).sort();

  if (refs.length) {
    for (const ref of refs) lines.push(`* \`${ref}\``);
  } else {
    lines.push("No additional endpoint references were found in response structure.");
  }

  lines.push("", "## Discovered actions", "");

  const actions = unique(
    manifest.routes.flatMap((route) => route.action_refs),
  ).sort();

  if (actions.length) {
    for (const action of actions) lines.push(`* \`${action}\``);
  } else {
    lines.push("No action constants were discovered.");
  }

  return lines.join("\n") + "\n";
}
