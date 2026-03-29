import { z } from "zod";
import { createGeneratedApiClient } from "./generated/client";

export const healthResponseSchema = z.object({
  status: z.string().min(1),
  app: z.string().min(1),
  version: z.string().min(1),
  environment: z.string().min(1),
  inventorySync: z.string().min(1).nullable().optional(),
  inventorySyncError: z.string().min(1).nullable().optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const userSchema = z.object({
  username: z.string().min(1),
  role: z.enum(["admin", "editor", "viewer"]),
});

export const recordTypeSchema = z.enum([
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "SRV",
  "NS",
  "PTR",
  "CAA",
  "SOA",
]);

export const sessionResponseSchema = z.object({
  authenticated: z.boolean(),
  user: userSchema.nullable(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const authSettingsResponseSchema = z.object({
  localLoginEnabled: z.boolean(),
  oidcEnabled: z.boolean(),
  oidcSelfSignupEnabled: z.boolean(),
  csrfEnabled: z.boolean(),
  sessionCookieName: z.string().min(1),
  sessionCookieSameSite: z.string().min(1),
  sessionCookieSecure: z.boolean(),
  sessionTtlSeconds: z.number().int().positive(),
  bootstrapAdminEnabled: z.boolean(),
});

export type AuthSettingsResponse = z.infer<typeof authSettingsResponseSchema>;

export const oidcProviderSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["oidc"]),
});

export const oidcProviderListResponseSchema = z.object({
  items: z.array(oidcProviderSchema),
});

export type OidcProviderListResponse = z.infer<typeof oidcProviderListResponseSchema>;
export type OidcProvider = z.infer<typeof oidcProviderSchema>;

export const oidcLoginStartResponseSchema = z.object({
  providerName: z.string().min(1),
  authorizationUrl: z.string().min(1),
});

export type OidcLoginStartResponse = z.infer<typeof oidcLoginStartResponseSchema>;

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const backendSchema = z.object({
  name: z.string().min(1),
  backendType: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
});

export const backendListResponseSchema = z.object({
  items: z.array(backendSchema),
});

export type BackendListResponse = z.infer<typeof backendListResponseSchema>;
export type Backend = z.infer<typeof backendSchema>;

export const adminUserSchema = z.object({
  username: z.string().min(1),
  role: z.enum(["admin", "editor", "viewer"]),
  authSource: z.string().min(1),
  isActive: z.boolean(),
});

export const adminUserListResponseSchema = z.object({
  items: z.array(adminUserSchema),
});

export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;

export const serviceAccountSchema = adminUserSchema;
export const serviceAccountListResponseSchema = z.object({
  items: z.array(serviceAccountSchema),
});
export const apiTokenCreateResponseSchema = z.object({
  username: z.string().min(1),
  tokenName: z.string().min(1),
  token: z.string().min(1),
});

export type ServiceAccount = z.infer<typeof serviceAccountSchema>;
export type ServiceAccountListResponse = z.infer<
  typeof serviceAccountListResponseSchema
>;
export type ApiTokenCreateResponse = z.infer<typeof apiTokenCreateResponseSchema>;

export const backendConfigRequestSchema = z.object({
  name: z.string().min(1),
  backendType: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
});

export const identityProviderConfigSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["oidc"]),
  issuer: z.string().min(1),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  hasClientSecret: z.boolean(),
  claimsMappingRules: z.record(z.string(), z.unknown()),
});

export const identityProviderConfigListResponseSchema = z.object({
  items: z.array(identityProviderConfigSchema),
});

export type IdentityProviderConfigListResponse = z.infer<
  typeof identityProviderConfigListResponseSchema
>;
export type IdentityProviderConfig = z.infer<typeof identityProviderConfigSchema>;

export const zoneGrantSchema = z.object({
  username: z.string().min(1),
  zoneName: z.string().min(1),
  actions: z.array(z.string().min(1)),
});

export const zoneGrantListResponseSchema = z.object({
  items: z.array(zoneGrantSchema),
});

export type ZoneGrantListResponse = z.infer<typeof zoneGrantListResponseSchema>;
export type ZoneGrant = z.infer<typeof zoneGrantSchema>;

export const discoveredZoneSchema = z.object({
  name: z.string().min(1),
  backendName: z.string().min(1),
  managed: z.boolean(),
});
export const zoneDiscoveryResponseSchema = z.object({
  backendName: z.string().min(1),
  items: z.array(discoveredZoneSchema),
});
export const zoneImportResponseSchema = z.object({
  backendName: z.string().min(1),
  importedZones: z.array(
    z.object({
      name: z.string().min(1),
      backendName: z.string().min(1),
    }),
  ),
});

export type DiscoveredZone = z.infer<typeof discoveredZoneSchema>;
export type ZoneDiscoveryResponse = z.infer<typeof zoneDiscoveryResponseSchema>;
export type ZoneImportResponse = z.infer<typeof zoneImportResponseSchema>;

export const zoneSchema = z.object({
  name: z.string().min(1),
  backendName: z.string().min(1),
});

export const zoneListResponseSchema = z.object({
  items: z.array(zoneSchema),
});

export type ZoneListResponse = z.infer<typeof zoneListResponseSchema>;
export type Zone = z.infer<typeof zoneSchema>;

export const recordDraftSchema = z
  .object({
    zoneName: z.string().min(1),
    name: z.string().min(1),
    recordType: z.preprocess((value) => {
      if (typeof value !== "string") {
        return value;
      }
      return value.toUpperCase();
    }, recordTypeSchema),
    ttl: z.number().int().positive(),
    values: z.array(z.string().min(1)),
  })
  .superRefine((record, ctx) => {
    function addIssue(message: string) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        path: ["values"],
      });
    }

    function requireSingleValue() {
      if (record.values.length !== 1) {
        addIssue(`${record.recordType} records must contain exactly one value`);
        return false;
      }
      return true;
    }

    function isDomainLike(value: string) {
      return value.trim().length > 0;
    }

    function isIPv4(value: string) {
      const octets = value.split(".");
      if (octets.length !== 4) {
        return false;
      }

      return octets.every((octet) => {
        if (!/^\d+$/.test(octet)) {
          return false;
        }
        const parsed = Number(octet);
        return parsed >= 0 && parsed <= 255;
      });
    }

    function isIPv6(value: string) {
      if (!/^[0-9A-Fa-f:]+$/.test(value) || !value.includes(":")) {
        return false;
      }

      const compressed = value.split("::");
      if (compressed.length > 2) {
        return false;
      }

      const parseHextets = (segment: string) =>
        segment === "" ? [] : segment.split(":");
      const left = parseHextets(compressed[0]);
      const right = compressed.length === 2 ? parseHextets(compressed[1]) : [];
      const allHextets = [...left, ...right];

      if (!allHextets.every((hextet) => /^[0-9A-Fa-f]{1,4}$/.test(hextet))) {
        return false;
      }

      if (compressed.length === 1) {
        return left.length === 8;
      }

      return left.length + right.length < 8;
    }

    switch (record.recordType) {
      case "A":
        for (const value of record.values) {
          if (!isIPv4(value)) {
            addIssue(`Invalid A record value: ${value}`);
          }
        }
        break;
      case "AAAA":
        for (const value of record.values) {
          if (!isIPv6(value)) {
            addIssue(`Invalid AAAA record value: ${value}`);
          }
        }
        break;
      case "CNAME":
      case "NS":
      case "PTR":
        if (requireSingleValue() && !isDomainLike(record.values[0])) {
          addIssue(`${record.recordType} record target must not be empty`);
        }
        break;
      case "MX":
        for (const value of record.values) {
          if (!/^\d+\s+\S+$/.test(value)) {
            addIssue(`Invalid MX record value: ${value}`);
          }
        }
        break;
      case "SRV":
        for (const value of record.values) {
          if (!/^\d+\s+\d+\s+\d+\s+\S+$/.test(value)) {
            addIssue(`Invalid SRV record value: ${value}`);
          }
        }
        break;
      case "CAA":
        for (const value of record.values) {
          if (!/^\d+\s+(issue|issuewild|iodef)\s+.+$/i.test(value)) {
            addIssue(`Invalid CAA record value: ${value}`);
          }
        }
        break;
      case "SOA":
        if (
          requireSingleValue() &&
          record.values[0].trim().split(/\s+/).length !== 7
        ) {
          addIssue("SOA record value must contain exactly 7 fields");
        }
        break;
      case "TXT":
        break;
    }
  });

export const recordSetSchema = recordDraftSchema.extend({
  version: z.string().min(1),
});

export const recordListResponseSchema = z.object({
  items: z.array(recordSetSchema),
});

export type RecordListResponse = z.infer<typeof recordListResponseSchema>;
export type RecordSet = z.infer<typeof recordSetSchema>;
export type RecordType = z.infer<typeof recordTypeSchema>;

export const bulkChangeItemSchema = z
  .object({
    operation: z.enum(["create", "update", "delete"]),
    name: z.string().min(1),
    recordType: recordTypeSchema,
    ttl: z.number().int().positive().optional(),
    values: z.array(z.string().min(1)).optional(),
    expectedVersion: z.string().min(1).optional(),
  })
  .superRefine((item, ctx) => {
    if (item.operation === "delete") {
      if (item.ttl !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ttl is not allowed for delete bulk changes",
          path: ["ttl"],
        });
      }
      if (item.values !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "values are not allowed for delete bulk changes",
          path: ["values"],
        });
      }
      return;
    }

    if (item.ttl === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ttl is required for create/update bulk changes",
        path: ["ttl"],
      });
    }
    if (!item.values || item.values.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "values are required for create/update bulk changes",
        path: ["values"],
      });
    }
  });
export const bulkChangeResponseSchema = z.object({
  zoneName: z.string().min(1),
  applied: z.boolean(),
  hasConflicts: z.boolean(),
  items: z.array(
    z.object({
      actor: z.string().min(1),
      zoneName: z.string().min(1),
      backendName: z.string().min(1),
      operation: z.enum(["create", "update", "delete"]),
      before: recordSetSchema.nullable().optional(),
      after: recordSetSchema.nullable().optional(),
      expectedVersion: z.string().min(1).nullable().optional(),
      currentVersion: z.string().min(1).nullable().optional(),
      hasConflict: z.boolean(),
      conflictReason: z.string().min(1).nullable().optional(),
      summary: z.string().min(1),
    }),
  ),
});

export type BulkChangeItem = z.infer<typeof bulkChangeItemSchema>;
export type BulkChangeResponse = z.infer<typeof bulkChangeResponseSchema>;

const fallbackApiBaseUrl =
  typeof window === "undefined"
    ? "http://127.0.0.1:8000"
    : `${window.location.protocol}//${window.location.hostname}:8000`;

function normalizeApiBaseUrl(rawApiBaseUrl: string) {
  if (typeof window === "undefined") {
    return rawApiBaseUrl;
  }

  try {
    const parsed = new URL(rawApiBaseUrl, window.location.origin);
    const localHosts = new Set(["localhost", "127.0.0.1"]);
    if (
      localHosts.has(parsed.hostname) &&
      localHosts.has(window.location.hostname)
    ) {
      parsed.hostname = window.location.hostname;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return rawApiBaseUrl;
  }
}

const apiBaseUrl = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? fallbackApiBaseUrl,
);
export const generatedApiClient = createGeneratedApiClient(apiBaseUrl);
const csrfCookieName = "zonix_csrf_token";
const csrfHeaderName = "X-CSRF-Token";

function readCookie(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const encodedName = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(";")) {
    const normalized = part.trim();
    if (normalized.startsWith(encodedName)) {
      return decodeURIComponent(normalized.slice(encodedName.length));
    }
  }

  return null;
}

function withCsrfHeaders(headers: Record<string, string>) {
  const csrfToken = readCookie(csrfCookieName);
  return csrfToken ? { ...headers, [csrfHeaderName]: csrfToken } : headers;
}

function detailFromError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "detail" in error &&
    typeof (error as { detail?: unknown }).detail === "string"
  ) {
    return (error as { detail: string }).detail;
  }
  return null;
}

async function unwrapGeneratedResponse<T>(
  request: Promise<{
    data?: unknown;
    error?: unknown;
    response: Response;
  }>,
  fallbackMessage: string,
  schema?: z.ZodType<T>,
): Promise<T> {
  const { data, error, response } = await request;
  if (!response.ok || data === undefined) {
    const detail = detailFromError(error);
    throw new Error(detail ?? `${fallbackMessage} with status ${response.status}`);
  }
  return schema ? schema.parse(data) : (data as T);
}

export async function fetchHealth(): Promise<HealthResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/health", {
      headers: { Accept: "application/json" },
    }),
    "Backend health check failed",
    healthResponseSchema,
  );
}

export async function fetchSession(): Promise<SessionResponse> {
  const { data, response } = await generatedApiClient.GET("/auth/me", {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 401) {
    return { authenticated: false, user: null };
  }

  if (!response.ok || data === undefined) {
    throw new Error(`Session lookup failed with status ${response.status}`);
  }

  return sessionResponseSchema.parse(data);
}

export async function fetchAuthSettings(): Promise<AuthSettingsResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/auth/settings", {
      headers: {
        Accept: "application/json",
      },
    }),
    "Auth settings lookup failed",
    authSettingsResponseSchema,
  );
}

export async function fetchOidcProviders(): Promise<OidcProviderListResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/auth/oidc/providers", {
      headers: {
        Accept: "application/json",
      },
    }),
    "OIDC provider lookup failed",
    oidcProviderListResponseSchema,
  );
}

export async function startOidcLogin(input: {
  providerName: string;
  returnTo: string;
}): Promise<OidcLoginStartResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/auth/oidc/{provider_name}/login", {
      params: {
        path: { provider_name: input.providerName },
        query: { return_to: input.returnTo },
      },
      headers: {
        Accept: "application/json",
      },
    }),
    "OIDC login start failed",
    oidcLoginStartResponseSchema,
  );
}

export async function login(input: {
  username: string;
  password: string;
}): Promise<SessionResponse> {
  const payload = loginRequestSchema.parse(input);
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/auth/login", {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: payload,
    }),
    "Invalid username or password",
    sessionResponseSchema,
  );
}

export async function logout(): Promise<SessionResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/auth/logout", {
      credentials: "include",
      headers: withCsrfHeaders({
        Accept: "application/json",
      }),
    }),
    "Logout failed",
    sessionResponseSchema,
  );
}

export async function fetchBackends(): Promise<BackendListResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/backends", {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Backend listing failed",
    backendListResponseSchema,
  );
}

export async function fetchAdminUsers(): Promise<AdminUserListResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/admin/users", {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Admin user listing failed",
    adminUserListResponseSchema,
  );
}

export async function updateAdminUserRole(input: {
  username: string;
  role: "admin" | "editor" | "viewer";
}) {
  return unwrapGeneratedResponse(
    generatedApiClient.PUT("/admin/users/{username}/role", {
      params: { path: { username: input.username } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: { role: input.role },
    }),
    "User role update failed",
    adminUserSchema,
  );
}

export async function fetchAdminBackends(): Promise<BackendListResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/admin/backends", {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Admin backend listing failed",
    backendListResponseSchema,
  );
}

export async function createAdminBackend(input: {
  name: string;
  backendType: string;
  capabilities: string[];
}) {
  const payload = backendConfigRequestSchema.parse(input);
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/admin/backends", {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: payload,
    }),
    "Admin backend save failed",
    backendSchema,
  );
}

export async function deleteAdminBackend(backendName: string) {
  await unwrapGeneratedResponse(
    generatedApiClient.DELETE("/admin/backends/{backend_name}", {
      params: { path: { backend_name: backendName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...withCsrfHeaders({}),
      },
    }),
    "Admin backend delete failed",
  );
}

export async function syncAdminBackendZones(backendName: string) {
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/admin/backends/{backend_name}/zones/sync", {
      params: { path: { backend_name: backendName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...withCsrfHeaders({}),
      },
    }),
    "Backend sync failed",
    z.object({
      backendName: z.string().min(1),
      syncedZones: z.array(zoneSchema),
    }),
  );
}

export async function discoverAdminBackendZones(
  backendName: string,
): Promise<ZoneDiscoveryResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/admin/backends/{backend_name}/zones/discover", {
      params: { path: { backend_name: backendName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Backend discovery failed",
    zoneDiscoveryResponseSchema,
  );
}

export async function importAdminBackendZones(input: {
  backendName: string;
  zoneNames?: string[];
}): Promise<ZoneImportResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/admin/backends/{backend_name}/zones/import", {
      params: { path: { backend_name: input.backendName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: {
        zoneNames: input.zoneNames,
      },
    }),
    "Backend import failed",
    zoneImportResponseSchema,
  );
}

export async function fetchAdminIdentityProviders(): Promise<IdentityProviderConfigListResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/admin/identity-providers", {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Identity provider listing failed",
    identityProviderConfigListResponseSchema,
  );
}

export async function createAdminIdentityProvider(input: {
  name: string;
  kind: "oidc";
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  claimsMappingRules: Record<string, unknown>;
}) {
  const payload = z
    .object({
      name: z.string().min(1),
      kind: z.enum(["oidc"]),
      issuer: z.string().min(1),
      clientId: z.string().min(1),
      clientSecret: z.string().min(1).optional(),
      scopes: z.array(z.string().min(1)),
      claimsMappingRules: z.record(z.string(), z.unknown()),
    })
    .parse(input);
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/admin/identity-providers", {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: payload,
    }),
    "Identity provider save failed",
    identityProviderConfigSchema,
  );
}

export async function deleteAdminIdentityProvider(providerName: string) {
  await unwrapGeneratedResponse(
    generatedApiClient.DELETE("/admin/identity-providers/{provider_name}", {
      params: { path: { provider_name: providerName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...withCsrfHeaders({}),
      },
    }),
    "Identity provider delete failed",
  );
}

export async function fetchAdminZoneGrants(
  username: string,
): Promise<ZoneGrantListResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/admin/grants/{username}", {
      params: { path: { username } },
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Zone grant listing failed",
    zoneGrantListResponseSchema,
  );
}

export async function assignAdminZoneGrant(input: {
  username: string;
  zoneName: string;
  actions: string[];
}) {
  const payload = zoneGrantSchema.parse(input);
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/admin/grants/zones", {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: payload,
    }),
    "Zone grant save failed",
    zoneGrantSchema,
  );
}

export async function fetchZones(): Promise<ZoneListResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/zones", {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Zone listing failed",
    zoneListResponseSchema,
  );
}

export async function fetchZone(zoneName: string) {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/zones/{zone_name}", {
      params: { path: { zone_name: zoneName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Zone detail failed",
    zoneSchema,
  );
}

export async function fetchZoneRecords(
  zoneName: string,
): Promise<RecordListResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/zones/{zone_name}/records", {
      params: { path: { zone_name: zoneName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Record listing failed",
    recordListResponseSchema,
  );
}

export async function createZoneRecord(input: {
  zoneName: string;
  name: string;
  recordType: RecordType;
  ttl: number;
  values: string[];
}) {
  const payload = recordDraftSchema.parse(input);
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/zones/{zone_name}/records", {
      params: { path: { zone_name: payload.zoneName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: payload,
    }),
    "Record create failed",
    recordSetSchema,
  );
}

export async function updateZoneRecord(input: {
  zoneName: string;
  name: string;
  recordType: RecordType;
  ttl: number;
  values: string[];
  expectedVersion: string;
}) {
  const payload = recordDraftSchema
    .extend({
      expectedVersion: z.string().min(1),
    })
    .parse(input);
  return unwrapGeneratedResponse(
    generatedApiClient.PUT("/zones/{zone_name}/records", {
      params: { path: { zone_name: payload.zoneName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: payload,
    }),
    "Record update failed",
    recordSetSchema,
  );
}

export async function deleteZoneRecord(input: {
  zoneName: string;
  name: string;
  recordType: RecordType;
  expectedVersion: string;
}) {
  const payload = z
    .object({
      zoneName: z.string().min(1),
      name: z.string().min(1),
      recordType: recordTypeSchema,
      expectedVersion: z.string().min(1),
    })
    .parse(input);
  await unwrapGeneratedResponse(
    generatedApiClient.DELETE("/zones/{zone_name}/records", {
      params: { path: { zone_name: payload.zoneName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: payload,
    }),
    "Record delete failed",
  );
}

export async function applyBulkZoneChanges(input: {
  zoneName: string;
  items: BulkChangeItem[];
}): Promise<BulkChangeResponse> {
  const payload = z
    .object({
      zoneName: z.string().min(1),
      items: z.array(bulkChangeItemSchema).min(1),
    })
    .parse(input);
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/zones/{zone_name}/changes/bulk", {
      params: { path: { zone_name: payload.zoneName } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: payload,
    }),
    "Bulk change apply failed",
    bulkChangeResponseSchema,
  );
}

export async function fetchAdminServiceAccounts(): Promise<ServiceAccountListResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.GET("/admin/service-accounts", {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }),
    "Service account listing failed",
    serviceAccountListResponseSchema,
  );
}

export async function createAdminServiceAccount(input: {
  username: string;
  role: "admin" | "editor" | "viewer";
}): Promise<ServiceAccount> {
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/admin/service-accounts", {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: input,
    }),
    "Service account creation failed",
    serviceAccountSchema,
  );
}

export async function createAdminServiceAccountToken(input: {
  username: string;
  name: string;
}): Promise<ApiTokenCreateResponse> {
  return unwrapGeneratedResponse(
    generatedApiClient.POST("/admin/service-accounts/{username}/tokens", {
      params: { path: { username: input.username } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: { name: input.name },
    }),
    "Service account token creation failed",
    apiTokenCreateResponseSchema,
  );
}
