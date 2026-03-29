import createClient from "openapi-fetch";

import type { paths } from "./api-types";

export function createGeneratedApiClient(baseUrl: string) {
  return createClient<paths>({
    baseUrl,
  });
}

export type GeneratedApiPaths = paths;
