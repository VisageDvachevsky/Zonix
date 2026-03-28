import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  assignAdminZoneGrant,
  createAdminBackend,
  createAdminIdentityProvider,
  deleteAdminBackend,
  deleteAdminIdentityProvider,
  fetchAdminBackends,
  fetchAdminIdentityProviders,
  fetchAdminUsers,
  fetchAdminZoneGrants,
  fetchBackends,
  fetchHealth,
  fetchSession,
  fetchZone,
  fetchZoneRecords,
  fetchZones,
  login,
  logout,
  syncAdminBackendZones,
  updateAdminUserRole,
} from "./api";
import { AdminConsole } from "./AdminConsole";
import "./styles.css";

type AdminSection = "backends" | "identity" | "access";

const adminSectionOptions: Array<{
  key: AdminSection;
  label: string;
  description: string;
}> = [
  {
    key: "backends",
    label: "Backends",
    description: "Register adapters, inspect capabilities, and sync zones.",
  },
  {
    key: "identity",
    label: "Identity",
    description: "Manage external IdPs and claims mapping rules.",
  },
  {
    key: "access",
    label: "Access",
    description: "Set global roles and zone-level grants for operators.",
  },
];

function normalizeCommaSeparatedList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toggleAction(actions: string[], action: string) {
  return actions.includes(action)
    ? actions.filter((item) => item !== action)
    : [...actions, action];
}

export function App() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [selectedZoneName, setSelectedZoneName] = useState<string | null>(null);
  const [selectedGrantUsername, setSelectedGrantUsername] = useState<string | null>(
    null,
  );
  const [selectedUserRole, setSelectedUserRole] = useState<"admin" | "editor" | "viewer">(
    "viewer",
  );
  const [adminSection, setAdminSection] = useState<AdminSection>("backends");
  const [editingBackendName, setEditingBackendName] = useState<string | null>(null);
  const [backendName, setBackendName] = useState("");
  const [backendType, setBackendType] = useState("powerdns");
  const [backendCapabilities, setBackendCapabilities] = useState(
    "readZones, readRecords, writeRecords",
  );
  const [editingProviderName, setEditingProviderName] = useState<string | null>(null);
  const [providerName, setProviderName] = useState("");
  const [providerIssuer, setProviderIssuer] = useState("https://issuer.example");
  const [providerClientId, setProviderClientId] = useState("zonix-ui");
  const [providerClientSecret, setProviderClientSecret] = useState("");
  const [providerScopes, setProviderScopes] = useState("openid, profile, email");
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [providerClaimsRules, setProviderClaimsRules] = useState(
    '{\n  "usernameClaim": "preferred_username",\n  "rolesClaim": "groups",\n  "adminGroups": ["dns-admins"],\n  "zoneEditorPattern": "zone-{zone}-editors",\n  "zoneViewerPattern": "zone-{zone}-viewers"\n}',
  );
  const [grantActions, setGrantActions] = useState<string[]>(["read"]);

  const healthQuery = useQuery({ queryKey: ["health"], queryFn: fetchHealth, retry: false });
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: fetchSession, retry: false });
  const session = sessionQuery.data;
  const isAuthenticated = session?.authenticated === true && session.user !== null;
  const currentUser = isAuthenticated ? session.user : null;
  const isAdmin = currentUser?.role === "admin";

  const backendsQuery = useQuery({
    queryKey: ["backends"],
    queryFn: fetchBackends,
    enabled: isAuthenticated,
    retry: false,
  });
  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: fetchZones,
    enabled: isAuthenticated,
    retry: false,
  });
  const zoneDetailQuery = useQuery({
    queryKey: ["zone", selectedZoneName],
    queryFn: () => fetchZone(selectedZoneName as string),
    enabled: isAuthenticated && selectedZoneName !== null,
    retry: false,
  });
  const zoneRecordsQuery = useQuery({
    queryKey: ["zone-records", selectedZoneName],
    queryFn: () => fetchZoneRecords(selectedZoneName as string),
    enabled: isAuthenticated && selectedZoneName !== null,
    retry: false,
  });
  const adminUsersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: fetchAdminUsers,
    enabled: isAdmin,
    retry: false,
  });
  const adminBackendsQuery = useQuery({
    queryKey: ["admin-backends"],
    queryFn: fetchAdminBackends,
    enabled: isAdmin,
    retry: false,
  });
  const adminIdentityProvidersQuery = useQuery({
    queryKey: ["admin-identity-providers"],
    queryFn: fetchAdminIdentityProviders,
    enabled: isAdmin,
    retry: false,
  });
  const adminZoneGrantsQuery = useQuery({
    queryKey: ["admin-zone-grants", selectedGrantUsername],
    queryFn: () => fetchAdminZoneGrants(selectedGrantUsername as string),
    enabled: isAdmin && selectedGrantUsername !== null,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async (nextSession) => {
      queryClient.setQueryData(["session"], nextSession);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-identity-providers"] }),
      ]);
    },
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async (nextSession) => {
      queryClient.setQueryData(["session"], nextSession);
      for (const key of [
        "backends",
        "zones",
        "zone",
        "zone-records",
        "admin-users",
        "admin-backends",
        "admin-identity-providers",
        "admin-zone-grants",
      ]) {
        queryClient.removeQueries({ queryKey: [key] });
      }
      setSelectedZoneName(null);
      setSelectedGrantUsername(null);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const createBackendMutation = useMutation({
    mutationFn: createAdminBackend,
    onSuccess: async () => {
      resetBackendForm();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
      ]);
    },
  });
  const syncBackendMutation = useMutation({
    mutationFn: syncAdminBackendZones,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-zone-grants"] }),
      ]);
    },
  });
  const deleteBackendMutation = useMutation({
    mutationFn: deleteAdminBackend,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
    },
  });
  const createIdentityProviderMutation = useMutation({
    mutationFn: createAdminIdentityProvider,
    onSuccess: async () => {
      resetProviderForm();
      await queryClient.invalidateQueries({ queryKey: ["admin-identity-providers"] });
    },
  });
  const deleteIdentityProviderMutation = useMutation({
    mutationFn: deleteAdminIdentityProvider,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-identity-providers"] });
    },
  });
  const updateUserRoleMutation = useMutation({
    mutationFn: updateAdminUserRole,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-zone-grants"] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
    },
  });
  const assignGrantMutation = useMutation({
    mutationFn: assignAdminZoneGrant,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-zone-grants"] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
    },
  });

  const zoneItems = zonesQuery.data?.items;
  const adminUsers = adminUsersQuery.data?.items ?? [];
  const selectedAdminUser =
    adminUsers.find((user) => user.username === selectedGrantUsername) ?? null;
  const activeAdminSection = adminSectionOptions.find(
    (section) => section.key === adminSection,
  );
  const isEditingCurrentUser = selectedGrantUsername === currentUser?.username;
  const isBackendFormDirty =
    editingBackendName !== null ||
    backendName.trim().length > 0 ||
    backendType.trim() !== "powerdns" ||
    backendCapabilities.trim() !== "readZones, readRecords, writeRecords";
  const isProviderFormDirty =
    editingProviderName !== null ||
    providerName.trim().length > 0 ||
    providerIssuer.trim() !== "https://issuer.example" ||
    providerClientId.trim() !== "zonix-ui" ||
    providerClientSecret.trim().length > 0 ||
    providerScopes.trim() !== "openid, profile, email" ||
    providerClaimsRules.trim() !==
      '{\n  "usernameClaim": "preferred_username",\n  "rolesClaim": "groups",\n  "adminGroups": ["dns-admins"],\n  "zoneEditorPattern": "zone-{zone}-editors",\n  "zoneViewerPattern": "zone-{zone}-viewers"\n}';
  const isRoleChangeBlocked =
    isEditingCurrentUser && selectedAdminUser?.role !== selectedUserRole;

  function resetBackendForm() {
    setEditingBackendName(null);
    setBackendName("");
    setBackendType("powerdns");
    setBackendCapabilities("readZones, readRecords, writeRecords");
  }

  function resetProviderForm() {
    setEditingProviderName(null);
    setProviderName("");
    setProviderIssuer("https://issuer.example");
    setProviderClientId("zonix-ui");
    setProviderClientSecret("");
    setProviderScopes("openid, profile, email");
    setProviderClaimsRules(
      '{\n  "usernameClaim": "preferred_username",\n  "rolesClaim": "groups",\n  "adminGroups": ["dns-admins"],\n  "zoneEditorPattern": "zone-{zone}-editors",\n  "zoneViewerPattern": "zone-{zone}-viewers"\n}',
    );
    setProviderFormError(null);
  }

  useEffect(() => {
    if (!isAuthenticated) return setSelectedZoneName(null);
    if (!zoneItems || zoneItems.length === 0) return setSelectedZoneName(null);
    if (!selectedZoneName || !zoneItems.some((zone) => zone.name === selectedZoneName)) {
      setSelectedZoneName(zoneItems[0].name);
    }
  }, [isAuthenticated, selectedZoneName, zoneItems]);

  useEffect(() => {
    if (!isAdmin) return setSelectedGrantUsername(null);
    if (adminUsers.length === 0) return setSelectedGrantUsername(null);
    if (
      !selectedGrantUsername ||
      !adminUsers.some((user) => user.username === selectedGrantUsername)
    ) {
      setSelectedGrantUsername(adminUsers[0].username);
    }
  }, [adminUsers, isAdmin, selectedGrantUsername]);

  useEffect(() => {
    if (!selectedAdminUser) {
      setSelectedUserRole("viewer");
      return;
    }
    setSelectedUserRole(selectedAdminUser.role);
  }, [selectedAdminUser]);

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate({ username, password });
  }

  function handleBackendSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createBackendMutation.mutate({
      name: backendName,
      backendType,
      capabilities: normalizeCommaSeparatedList(backendCapabilities),
    });
  }

  function handleIdentityProviderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let claimsMappingRules: Record<string, unknown>;
    try {
      claimsMappingRules = JSON.parse(providerClaimsRules) as Record<string, unknown>;
    } catch {
      setProviderFormError("Claims mapping rules must be valid JSON.");
      return;
    }
    setProviderFormError(null);
    createIdentityProviderMutation.mutate({
      name: providerName,
      kind: "oidc",
      issuer: providerIssuer,
      clientId: providerClientId,
      clientSecret:
        providerClientSecret.trim().length > 0 ? providerClientSecret : undefined,
      scopes: normalizeCommaSeparatedList(providerScopes),
      claimsMappingRules,
    });
  }

  function handleGrantSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGrantUsername || !selectedZoneName) return;
    assignGrantMutation.mutate({
      username: selectedGrantUsername,
      zoneName: selectedZoneName,
      actions: grantActions,
    });
  }

  function handleRoleSubmit() {
    if (!selectedGrantUsername) return;
    updateUserRoleMutation.mutate({
      username: selectedGrantUsername,
      role: selectedUserRole,
    });
  }

  if (!isAuthenticated) {
    return (
      <main className="app-shell">
        <div className="backdrop-orb orb-left" />
        <div className="backdrop-orb orb-right" />

        <section className="hero-shell">
          <section className="hero-copy">
            <p className="eyebrow">Zonix Day 19</p>
            <h1>Sign in to Zonix.</h1>
            <p className="lede">
              Authenticate with your operator account, inspect live DNS state,
              and manage backend, identity, and access configuration from one
              place.
            </p>

            <form className="login-form" onSubmit={handleLoginSubmit}>
              <label>
                <span>Username</span>
                <input
                  autoComplete="username"
                  name="username"
                  onChange={(event) => setUsername(event.target.value)}
                  value={username}
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  autoComplete="current-password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </label>
              <button
                className="primary-button"
                disabled={loginMutation.isPending}
                type="submit"
              >
                {loginMutation.isPending ? "Signing in..." : "Sign in"}
              </button>
              <p className="helper-copy">
                Use your bootstrap admin password or the credentials already
                seeded into the local stack.
              </p>
              {loginMutation.isError ? (
                <p className="status-error">Invalid username or password.</p>
              ) : null}
            </form>
          </section>

          <aside className="status-panel">
            <div className="status-panel-header">
              <span className="status-kicker">System pulse</span>
              <span
                className={`status-dot ${
                  healthQuery.data?.status === "ok"
                    ? "status-dot-live"
                    : "status-dot-muted"
                }`}
              />
            </div>
            <h2>Backend connectivity</h2>
            {healthQuery.isLoading ? <p>Checking API health...</p> : null}
            {healthQuery.isError ? (
              <p className="status-error">
                Backend unavailable. Start the compose stack or `npm run
                dev:backend`.
              </p>
            ) : null}
            {healthQuery.data ? (
              <dl className="status-list">
                <div>
                  <dt>Status</dt>
                  <dd>{healthQuery.data.status}</dd>
                </div>
                <div>
                  <dt>App</dt>
                  <dd>{healthQuery.data.app}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{healthQuery.data.version}</dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>{healthQuery.data.environment}</dd>
                </div>
                <div>
                  <dt>Inventory sync</dt>
                  <dd>{healthQuery.data.inventorySync ?? "pending"}</dd>
                </div>
              </dl>
            ) : null}
            {healthQuery.data?.inventorySyncError ? (
              <p className="status-error">{healthQuery.data.inventorySyncError}</p>
            ) : null}
          </aside>
        </section>

        <section
          className="capability-strip"
          aria-label="Available control-plane surfaces"
        >
          <span className="capability-strip-label">In scope</span>
          <div className="capability-list">
            <span>Local auth</span>
            <span>OIDC role mapping</span>
            <span>Backend config admin</span>
            <span>IdP config admin</span>
            <span>Role bindings</span>
            <span>Zone sync</span>
            <span>Audit trail</span>
          </div>
        </section>

        <section className="grid preauth-grid">
          <article className="panel panel-backends">
            <p className="panel-label">Configured backends</p>
            <h2>What the current identity can reach.</h2>
            <p className="placeholder-copy">
              Sign in to load configured backends and admin config panels.
            </p>
          </article>

          <article className="panel panel-zones">
            <p className="panel-label">Accessible zones</p>
            <h2>Scoped by current role and grants.</h2>
            <p className="placeholder-copy">Zone visibility appears after login.</p>
          </article>

          <article className="panel panel-detail">
            <p className="panel-label">Zone detail</p>
            <h2>Pick a zone to inspect.</h2>
            <p className="placeholder-copy">
              Zonix keeps backend identity, zone metadata, and record inventory in one
              workspace, so operators do not have to jump between provider consoles.
            </p>
          </article>

          <article className="panel panel-records panel-records-preview">
            <p className="panel-label">Record sets</p>
            <h2>Normalized RRsets, not provider payloads.</h2>
            <p className="placeholder-copy">
              Record sets appear after selecting a zone.
            </p>
            <div className="record-preview-list" aria-hidden="true">
              <div className="record-preview-item">
                <span className="record-preview-name">www</span>
                <span className="record-preview-meta">A · TTL 300</span>
                <span className="record-preview-value">192.0.2.10</span>
              </div>
              <div className="record-preview-item record-preview-item-accent">
                <span className="record-preview-name">@</span>
                <span className="record-preview-meta">SOA · TTL 300</span>
                <span className="record-preview-value">
                  ns1.example.com. hostmaster.example.com. ...
                </span>
              </div>
            </div>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="backdrop-orb orb-left" />
      <div className="backdrop-orb orb-right" />

      <section className="workspace-shell">
        <header className="panel workspace-header">
          <div className="workspace-copy">
            <p className="eyebrow">Zonix Day 19</p>
            <h1>Control plane workspace</h1>
            <p className="lede">
              Inspect backend reachability, browse zones, and operate the admin
              console without dropping into database edits or provider-specific
              payloads.
            </p>
          </div>
          <div className="workspace-controls">
            <div className="inline-stat">
              <span className="inline-stat-label">Signed in as</span>
              <strong>{currentUser?.username}</strong>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">Role</span>
              <strong>{currentUser?.role}</strong>
            </div>
            <button
              className="primary-button secondary-button"
              disabled={logoutMutation.isPending}
              onClick={() => logoutMutation.mutate()}
              type="button"
            >
              {logoutMutation.isPending ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </header>

        <aside className="status-panel workspace-status">
          <div className="status-panel-header">
            <span className="status-kicker">System pulse</span>
            <span
              className={`status-dot ${
                healthQuery.data?.status === "ok"
                  ? "status-dot-live"
                  : "status-dot-muted"
              }`}
            />
          </div>
          <h2>Backend connectivity</h2>
          {healthQuery.isLoading ? <p>Checking API health...</p> : null}
          {healthQuery.isError ? (
            <p className="status-error">
              Backend unavailable. Start the compose stack or `npm run
              dev:backend`.
            </p>
          ) : null}
          {healthQuery.data ? (
            <dl className="status-list">
              <div>
                <dt>Status</dt>
                <dd>{healthQuery.data.status}</dd>
              </div>
              <div>
                <dt>App</dt>
                <dd>{healthQuery.data.app}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{healthQuery.data.version}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{healthQuery.data.environment}</dd>
              </div>
              <div>
                <dt>Inventory sync</dt>
                <dd>{healthQuery.data.inventorySync ?? "pending"}</dd>
              </div>
            </dl>
          ) : null}
          {healthQuery.data?.inventorySyncError ? (
            <p className="status-error">{healthQuery.data.inventorySyncError}</p>
          ) : null}
        </aside>
      </section>

      <section
        className="capability-strip workspace-capability-strip"
        aria-label="Available control-plane surfaces"
      >
        <span className="capability-strip-label">Surface coverage</span>
        <div className="capability-list">
          <span>Local auth</span>
          <span>OIDC role mapping</span>
          <span>Backend config admin</span>
          <span>IdP config admin</span>
          <span>Role bindings</span>
          <span>Zone sync</span>
          <span>Audit trail</span>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="workspace-sidebar">
          <article className="panel panel-backends">
            <p className="panel-label">Configured backends</p>
            <h2>Reachable backends.</h2>
            <p>
              Operator-facing inventory still comes from the shared service
              layer, filtered by the current identity.
            </p>
            {backendsQuery.isLoading ? <p className="placeholder-copy">Loading backends...</p> : null}
            {backendsQuery.isError ? (
              <p className="status-error">Backend inventory could not be loaded.</p>
            ) : null}
            <ul className="resource-list backend-list">
              {backendsQuery.data?.items.map((backend) => (
                <li key={backend.name}>
                  <div className="resource-copy">
                    <strong>{backend.name}</strong>
                    <span>{backend.backendType}</span>
                  </div>
                </li>
              ))}
            </ul>
            {backendsQuery.data && backendsQuery.data.items.length === 0 ? (
              <p className="placeholder-copy">No backend configs are reachable yet.</p>
            ) : null}
          </article>

          <article className="panel panel-zones">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Accessible zones</p>
                <h2>Choose a zone.</h2>
              </div>
              <span className="panel-meta">{zoneItems?.length ?? 0} zones</span>
            </div>
            {zonesQuery.isLoading ? <p className="placeholder-copy">Loading zones...</p> : null}
            {zonesQuery.isError ? (
              <p className="status-error">Zone inventory could not be loaded.</p>
            ) : null}
            <ul className="resource-list zone-list">
              {(zoneItems ?? []).map((zone) => {
                const isSelected = zone.name === selectedZoneName;
                return (
                  <li
                    key={zone.name}
                    className={`resource-item-action zone-item ${
                      isSelected ? "zone-item-active" : ""
                    }`}
                  >
                    <div className="resource-copy">
                      <strong>{zone.name}</strong>
                      <span>{zone.backendName}</span>
                    </div>
                    <button
                      aria-pressed={isSelected}
                      className="primary-button secondary-button"
                      onClick={() => setSelectedZoneName(zone.name)}
                      type="button"
                    >
                      {isSelected ? "Selected" : "Inspect"}
                    </button>
                  </li>
                );
              })}
            </ul>
            {zonesQuery.data && zonesQuery.data.items.length === 0 ? (
              <p className="placeholder-copy">
                No zones are currently visible for this identity.
              </p>
            ) : null}
          </article>
        </aside>

        <section className="workspace-main">
          <article className="panel panel-detail">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Zone detail</p>
                <h2>{zoneDetailQuery.data?.name ?? "Pick a zone to inspect."}</h2>
              </div>
              <div className="panel-heading-actions">
                {zoneDetailQuery.data ? (
                  <span className="panel-meta">
                    {zoneRecordsQuery.data?.items.length ?? 0} records
                  </span>
                ) : null}
                {isAdmin && selectedZoneName ? (
                  <button
                    className="primary-button secondary-button"
                    onClick={() => setAdminSection("access")}
                    type="button"
                  >
                    Manage access
                  </button>
                ) : null}
              </div>
            </div>
            {selectedZoneName === null ? (
              <p className="placeholder-copy">
                Choose a zone from the list to load its current state.
              </p>
            ) : null}
            {zoneDetailQuery.isError ? (
              <p className="status-error">
                Zone detail could not be loaded from the backend.
              </p>
            ) : null}
            {zoneDetailQuery.data ? (
              <dl className="status-list detail-list">
                <div>
                  <dt>Zone</dt>
                  <dd>{zoneDetailQuery.data.name}</dd>
                </div>
                <div>
                  <dt>Backend</dt>
                  <dd>{zoneDetailQuery.data.backendName}</dd>
                </div>
                <div>
                  <dt>Records</dt>
                  <dd>{zoneRecordsQuery.data?.items.length ?? 0}</dd>
                </div>
              </dl>
            ) : null}
          </article>

          <div
            className={`workspace-main-deck ${
              isAdmin ? "workspace-main-deck-drawer-open" : ""
            }`}
          >
            <div className="workspace-content-column">
              <article className="panel panel-records">
                <div className="panel-heading">
                  <div>
                    <p className="panel-label">Record sets</p>
                    <h2>Current zone inventory.</h2>
                  </div>
                  {zoneRecordsQuery.data ? (
                    <span className="panel-meta">Normalized RRsets</span>
                  ) : null}
                </div>
                {zoneRecordsQuery.isError ? (
                  <p className="status-error">
                    Record inventory could not be loaded from the backend.
                  </p>
                ) : null}
                {zoneRecordsQuery.data ? (
                  <div className="record-table-shell">
                    <div className="record-table-head" aria-hidden="true">
                      <span>Type</span>
                      <span>Name</span>
                      <span>TTL</span>
                      <span>Value</span>
                    </div>
                    <ul className="resource-list records-list record-table">
                      {zoneRecordsQuery.data.items.map((record) => (
                        <li
                          key={`${record.name}-${record.recordType}`}
                          className={`record-item record-item-${record.recordType.toLowerCase()}`}
                        >
                          <div className="record-cell record-cell-type">
                            <span className="record-badge">{record.recordType}</span>
                          </div>
                          <div className="record-cell record-cell-name">
                            <p className="record-name">{record.name}</p>
                          </div>
                          <div className="record-cell record-cell-ttl">
                            <span className="record-ttl">{record.ttl}</span>
                          </div>
                          <div className="record-cell record-cell-value">
                            <p className="record-values">{record.values.join(", ")}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="placeholder-copy">
                    Record sets appear after selecting a zone.
                  </p>
                )}
              </article>
            </div>

            {isAdmin ? (
              <aside className="admin-drawer" aria-label="Admin drawer">
                <div className="admin-drawer-shell">
                  <div className="admin-drawer-header">
                    <div>
                      <p className="panel-label">Admin</p>
                      <h2>
                        {adminSection === "access" && selectedZoneName
                          ? `Access for ${selectedZoneName}`
                          : activeAdminSection?.label ?? "Admin console"}
                      </h2>
                      <p className="admin-drawer-copy">
                        {adminSection === "access"
                          ? selectedZoneName
                            ? "Access changes stay pinned to the zone currently selected in the workspace."
                            : "Pick a zone in the workspace to anchor access changes."
                          : activeAdminSection?.description}
                      </p>
                    </div>
                  </div>
                  <AdminConsole
                    showHeader={false}
                    activeSection={adminSection}
                    activeSectionDescription={activeAdminSection?.description}
                    activeSectionLabel={activeAdminSection?.label}
                    adminBackends={adminBackendsQuery.data?.items ?? []}
                    adminBackendsLoading={adminBackendsQuery.isLoading}
                    adminIdentityProviders={adminIdentityProvidersQuery.data?.items ?? []}
                    adminIdentityProvidersLoading={adminIdentityProvidersQuery.isLoading}
                    adminUsers={adminUsers}
                    adminZoneGrants={adminZoneGrantsQuery.data?.items ?? []}
                    adminZoneGrantsLoading={adminZoneGrantsQuery.isLoading}
                    assignGrantError={assignGrantMutation.isError}
                    assignGrantPending={assignGrantMutation.isPending}
                    assignGrantSuccess={assignGrantMutation.isSuccess}
                    backendCapabilities={backendCapabilities}
                    backendName={backendName}
                    backendType={backendType}
                    createBackendError={createBackendMutation.isError}
                    createBackendPending={createBackendMutation.isPending}
                    createBackendSuccess={createBackendMutation.isSuccess}
                    createIdentityProviderError={createIdentityProviderMutation.isError}
                    createIdentityProviderPending={createIdentityProviderMutation.isPending}
                    createIdentityProviderSuccess={createIdentityProviderMutation.isSuccess}
                    deleteBackendPending={deleteBackendMutation.isPending}
                    deleteIdentityProviderPending={deleteIdentityProviderMutation.isPending}
                    editingBackendName={editingBackendName}
                    editingProviderName={editingProviderName}
                    grantActions={grantActions}
                    isBackendFormDirty={isBackendFormDirty}
                    isEditingCurrentUser={isEditingCurrentUser}
                    isProviderFormDirty={isProviderFormDirty}
                    isRoleChangeBlocked={isRoleChangeBlocked}
                    onBackendSubmit={handleBackendSubmit}
                    onDeleteBackend={(backendNameToDelete) => {
                      if (window.confirm(`Delete backend config '${backendNameToDelete}'?`)) {
                        deleteBackendMutation.mutate(backendNameToDelete);
                      }
                    }}
                    onDeleteIdentityProvider={(providerNameToDelete) => {
                      if (window.confirm(`Delete IdP config '${providerNameToDelete}'?`)) {
                        deleteIdentityProviderMutation.mutate(providerNameToDelete);
                      }
                    }}
                    onEditBackend={(backend) => {
                      setEditingBackendName(backend.name);
                      setBackendName(backend.name);
                      setBackendType(backend.backendType);
                      setBackendCapabilities(backend.capabilities.join(", "));
                      setAdminSection("backends");
                    }}
                    onEditIdentityProvider={(provider) => {
                      setEditingProviderName(provider.name);
                      setProviderName(provider.name);
                      setProviderIssuer(provider.issuer);
                      setProviderClientId(provider.clientId);
                      setProviderClientSecret("");
                      setProviderScopes(provider.scopes.join(", "));
                      setProviderClaimsRules(JSON.stringify(provider.claimsMappingRules, null, 2));
                      setProviderFormError(null);
                      setAdminSection("identity");
                    }}
                    onGrantSubmit={handleGrantSubmit}
                    onIdentityProviderSubmit={handleIdentityProviderSubmit}
                    onResetBackendForm={resetBackendForm}
                    onResetProviderForm={resetProviderForm}
                    onRoleSubmit={handleRoleSubmit}
                    onSectionChange={setAdminSection}
                    onSyncBackend={(backendNameToSync) =>
                      syncBackendMutation.mutate(backendNameToSync)
                    }
                    providerClaimsRules={providerClaimsRules}
                    providerClientId={providerClientId}
                    providerClientSecret={providerClientSecret}
                    providerFormError={providerFormError}
                    providerIssuer={providerIssuer}
                    providerName={providerName}
                    providerScopes={providerScopes}
                    selectedAdminUserRole={selectedAdminUser?.role}
                    selectedGrantUsername={selectedGrantUsername}
                    selectedUserRole={selectedUserRole}
                    setBackendCapabilities={setBackendCapabilities}
                    setBackendName={setBackendName}
                    setBackendType={setBackendType}
                    setProviderClaimsRules={setProviderClaimsRules}
                    setProviderClientId={setProviderClientId}
                    setProviderClientSecret={setProviderClientSecret}
                    setProviderIssuer={setProviderIssuer}
                    setProviderName={setProviderName}
                    setProviderScopes={setProviderScopes}
                    setSelectedGrantUsername={setSelectedGrantUsername}
                    setSelectedUserRole={setSelectedUserRole}
                    syncBackendPending={syncBackendMutation.isPending}
                    toggleGrantAction={(action) =>
                      setGrantActions((current) => toggleAction(current, action))
                    }
                    updateUserRoleError={updateUserRoleMutation.isError}
                    updateUserRolePending={updateUserRoleMutation.isPending}
                    updateUserRoleSuccess={updateUserRoleMutation.isSuccess}
                    zoneContextName={selectedZoneName}
                  />
                </div>
              </aside>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
