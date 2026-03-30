export type AppRoute =
  | { kind: "zones" }
  | { kind: "zone"; zoneName: string }
  | { kind: "backends" }
  | { kind: "audit" }
  | { kind: "admin-access" }
  | { kind: "admin-backends" }
  | { kind: "admin-identity" }
  | { kind: "auth" };

function normalizeHash(hash: string) {
  const normalized = hash.replace(/^#/, "").trim();
  return normalized.length === 0 ? "/zones" : normalized;
}

export function parseHashRoute(hash: string): AppRoute {
  const normalized = normalizeHash(hash);
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { kind: "zones" };
  }

  if (segments[0] === "zones" && segments.length === 1) {
    return { kind: "zones" };
  }

  if (segments[0] === "zones" && segments.length >= 2) {
    return { kind: "zone", zoneName: decodeURIComponent(segments.slice(1).join("/")) };
  }

  if (segments[0] === "backends") {
    return { kind: "backends" };
  }

  if (segments[0] === "audit") {
    return { kind: "audit" };
  }

  if (segments[0] === "admin" && segments[1] === "access") {
    return { kind: "admin-access" };
  }

  if (segments[0] === "admin" && segments[1] === "backends") {
    return { kind: "admin-backends" };
  }

  if (segments[0] === "admin" && segments[1] === "identity") {
    return { kind: "admin-identity" };
  }

  if (segments[0] === "auth") {
    return { kind: "auth" };
  }

  return { kind: "zones" };
}

export function routeToHash(route: AppRoute) {
  switch (route.kind) {
    case "zones":
      return "#/zones";
    case "zone":
      return `#/zones/${encodeURIComponent(route.zoneName)}`;
    case "backends":
      return "#/backends";
    case "audit":
      return "#/audit";
    case "admin-access":
      return "#/admin/access";
    case "admin-backends":
      return "#/admin/backends";
    case "admin-identity":
      return "#/admin/identity";
    case "auth":
      return "#/auth";
  }
}
