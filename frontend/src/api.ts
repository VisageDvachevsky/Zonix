import { z } from "zod";

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

export const zoneGrantSchema = z.object({
  username: z.string().min(1),
  zoneName: z.string().min(1),
  actions: z.array(z.string().min(1)),
});

export const zoneGrantListResponseSchema = z.object({
  items: z.array(zoneGrantSchema),
});

export type ZoneGrantListResponse = z.infer<typeof zoneGrantListResponseSchema>;

export const zoneSchema = z.object({
  name: z.string().min(1),
  backendName: z.string().min(1),
});

export const zoneListResponseSchema = z.object({
  items: z.array(zoneSchema),
});

export type ZoneListResponse = z.infer<typeof zoneListResponseSchema>;

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

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiBaseUrl}/health`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Backend health check failed with status ${response.status}`,
    );
  }

  return healthResponseSchema.parse(await response.json());
}

export async function fetchSession(): Promise<SessionResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/me`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 401) {
    return { authenticated: false, user: null };
  }

  if (!response.ok) {
    throw new Error(`Session lookup failed with status ${response.status}`);
  }

  return sessionResponseSchema.parse(await response.json());
}

export async function fetchAuthSettings(): Promise<AuthSettingsResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/settings`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Auth settings lookup failed with status ${response.status}`,
    );
  }

  return authSettingsResponseSchema.parse(await response.json());
}

export async function login(input: {
  username: string;
  password: string;
}): Promise<SessionResponse> {
  const payload = loginRequestSchema.parse(input);
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Invalid username or password");
  }

  return sessionResponseSchema.parse(await response.json());
}

export async function logout(): Promise<SessionResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: withCsrfHeaders({
      Accept: "application/json",
    }),
  });

  if (!response.ok) {
    throw new Error(`Logout failed with status ${response.status}`);
  }

  return sessionResponseSchema.parse(await response.json());
}

export async function fetchBackends(): Promise<BackendListResponse> {
  const response = await fetch(`${apiBaseUrl}/backends`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Backend listing failed with status ${response.status}`);
  }

  return backendListResponseSchema.parse(await response.json());
}

export async function fetchAdminUsers(): Promise<AdminUserListResponse> {
  const response = await fetch(`${apiBaseUrl}/admin/users`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Admin user listing failed with status ${response.status}`);
  }

  return adminUserListResponseSchema.parse(await response.json());
}

export async function updateAdminUserRole(input: {
  username: string;
  role: "admin" | "editor" | "viewer";
}) {
  const response = await fetch(
    `${apiBaseUrl}/admin/users/${encodeURIComponent(input.username)}/role`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...withCsrfHeaders({}),
      },
      body: JSON.stringify({ role: input.role }),
    },
  );

  if (!response.ok) {
    throw new Error(`User role update failed with status ${response.status}`);
  }

  return adminUserSchema.parse(await response.json());
}

export async function fetchAdminBackends(): Promise<BackendListResponse> {
  const response = await fetch(`${apiBaseUrl}/admin/backends`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Admin backend listing failed with status ${response.status}`,
    );
  }

  return backendListResponseSchema.parse(await response.json());
}

export async function createAdminBackend(input: {
  name: string;
  backendType: string;
  capabilities: string[];
}) {
  const payload = backendConfigRequestSchema.parse(input);
  const response = await fetch(`${apiBaseUrl}/admin/backends`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...withCsrfHeaders({}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Admin backend save failed with status ${response.status}`);
  }

  return backendSchema.parse(await response.json());
}

export async function deleteAdminBackend(backendName: string) {
  const response = await fetch(
    `${apiBaseUrl}/admin/backends/${encodeURIComponent(backendName)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...withCsrfHeaders({}),
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Admin backend delete failed with status ${response.status}`,
    );
  }
}

export async function syncAdminBackendZones(backendName: string) {
  const response = await fetch(
    `${apiBaseUrl}/admin/backends/${encodeURIComponent(backendName)}/zones/sync`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...withCsrfHeaders({}),
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Backend sync failed with status ${response.status}`);
  }

  return z
    .object({
      backendName: z.string().min(1),
      syncedZones: z.array(zoneSchema),
    })
    .parse(await response.json());
}

export async function fetchAdminIdentityProviders(): Promise<IdentityProviderConfigListResponse> {
  const response = await fetch(`${apiBaseUrl}/admin/identity-providers`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Identity provider listing failed with status ${response.status}`,
    );
  }

  return identityProviderConfigListResponseSchema.parse(await response.json());
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
  const response = await fetch(`${apiBaseUrl}/admin/identity-providers`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...withCsrfHeaders({}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Identity provider save failed with status ${response.status}`,
    );
  }

  return identityProviderConfigSchema.parse(await response.json());
}

export async function deleteAdminIdentityProvider(providerName: string) {
  const response = await fetch(
    `${apiBaseUrl}/admin/identity-providers/${encodeURIComponent(providerName)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...withCsrfHeaders({}),
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Identity provider delete failed with status ${response.status}`,
    );
  }
}

export async function fetchAdminZoneGrants(
  username: string,
): Promise<ZoneGrantListResponse> {
  const response = await fetch(
    `${apiBaseUrl}/admin/grants/${encodeURIComponent(username)}`,
    {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Zone grant listing failed with status ${response.status}`);
  }

  return zoneGrantListResponseSchema.parse(await response.json());
}

export async function assignAdminZoneGrant(input: {
  username: string;
  zoneName: string;
  actions: string[];
}) {
  const payload = zoneGrantSchema.parse(input);
  const response = await fetch(`${apiBaseUrl}/admin/grants/zones`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...withCsrfHeaders({}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Zone grant save failed with status ${response.status}`);
  }

  return zoneGrantSchema.parse(await response.json());
}

export async function fetchZones(): Promise<ZoneListResponse> {
  const response = await fetch(`${apiBaseUrl}/zones`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Zone listing failed with status ${response.status}`);
  }

  return zoneListResponseSchema.parse(await response.json());
}

export async function fetchZone(zoneName: string) {
  const response = await fetch(
    `${apiBaseUrl}/zones/${encodeURIComponent(zoneName)}`,
    {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Zone detail failed with status ${response.status}`);
  }

  return zoneSchema.parse(await response.json());
}

export async function fetchZoneRecords(
  zoneName: string,
): Promise<RecordListResponse> {
  const response = await fetch(
    `${apiBaseUrl}/zones/${encodeURIComponent(zoneName)}/records`,
    {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Record listing failed with status ${response.status}`);
  }

  return recordListResponseSchema.parse(await response.json());
}
