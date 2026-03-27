import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.string().min(1),
  app: z.string().min(1),
  version: z.string().min(1),
  environment: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const userSchema = z.object({
  username: z.string().min(1),
  role: z.enum(["admin", "editor", "viewer"]),
});

export const sessionResponseSchema = z.object({
  authenticated: z.boolean(),
  user: userSchema.nullable(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

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

export const zoneSchema = z.object({
  name: z.string().min(1),
  backendName: z.string().min(1),
});

export const zoneListResponseSchema = z.object({
  items: z.array(zoneSchema),
});

export type ZoneListResponse = z.infer<typeof zoneListResponseSchema>;

export const recordSetSchema = z.object({
  zoneName: z.string().min(1),
  name: z.string().min(1),
  recordType: z.string().min(1),
  ttl: z.number().int().positive(),
  values: z.array(z.string().min(1)),
});

export const recordListResponseSchema = z.object({
  items: z.array(recordSetSchema),
});

export type RecordListResponse = z.infer<typeof recordListResponseSchema>;

const fallbackApiBaseUrl =
  typeof window === "undefined"
    ? "http://127.0.0.1:8000"
    : `${window.location.protocol}//${window.location.hostname}:8000`;

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? fallbackApiBaseUrl;

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
    headers: {
      Accept: "application/json",
    },
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
