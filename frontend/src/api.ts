import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.string().min(1),
  app: z.string().min(1),
  version: z.string().min(1),
  environment: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

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
    throw new Error(`Backend health check failed with status ${response.status}`);
  }

  return healthResponseSchema.parse(await response.json());
}
