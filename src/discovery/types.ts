export interface SanitizedRequestBody {
  content_type?: string;
  fields?: Record<string, unknown>;
  body_kind?: "form" | "json" | "multipart" | "text" | "none";
}

export interface SanitizedResponseStructure {
  kind: "html" | "json" | "xml" | "javascript" | "text" | "binary";
  forms?: Array<{
    method: string;
    action?: string;
    input_names: string[];
    select_names: string[];
    textarea_names: string[];
  }>;
  table_ids?: string[];
  element_ids?: string[];
  data_attributes?: string[];
  same_origin_links?: string[];
  endpoint_refs?: string[];
  action_refs?: string[];
  json_shape?: unknown;
  xml_tags?: string[];
}

export interface DiscoveryEvent {
  at: string;
  method: string;
  path: string;
  resource_type: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  request: SanitizedRequestBody;
  response?: {
    status: number;
    content_type?: string;
    structure?: SanitizedResponseStructure;
  };
}

export interface DiscoveryNavigation {
  at: string;
  path: string;
}

export interface DiscoveryRouteSummary {
  path: string;
  methods: string[];
  count: number;
  resource_types: string[];
  statuses: number[];
  content_types: string[];
  query_keys: string[];
  request_fields: string[];
  control_values: Record<string, string[]>;
  endpoint_refs: string[];
  action_refs: string[];
  table_ids: string[];
  form_actions: string[];
}

export interface DiscoveryManifest {
  version: 1;
  generated_at: string;
  capture_origin: string;
  browser: string;
  privacy: {
    raw_bodies_written: false;
    cookies_written: false;
    authorization_headers_written: false;
    response_text_written: false;
    note: string;
  };
  navigations: DiscoveryNavigation[];
  routes: DiscoveryRouteSummary[];
  events: DiscoveryEvent[];
}
