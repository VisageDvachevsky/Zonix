type AdminSection = "backends" | "identity" | "access";

type AdminUser = {
  username: string;
  role: "admin" | "editor" | "viewer";
};

type BackendConfig = {
  name: string;
  backendType: string;
  capabilities: string[];
};

type IdentityProviderConfig = {
  name: string;
  issuer: string;
  clientId: string;
  scopes: string[];
  hasClientSecret: boolean;
  claimsMappingRules: Record<string, unknown>;
};

type ZoneGrant = {
  username: string;
  zoneName: string;
  actions: string[];
};

type AdminConsoleProps = {
  showHeader?: boolean;
  activeSection: AdminSection;
  activeSectionLabel?: string;
  activeSectionDescription?: string;
  onSectionChange: (section: AdminSection) => void;
  editingBackendName: string | null;
  isBackendFormDirty: boolean;
  backendName: string;
  backendType: string;
  backendCapabilities: string;
  setBackendName: (value: string) => void;
  setBackendType: (value: string) => void;
  setBackendCapabilities: (value: string) => void;
  onResetBackendForm: () => void;
  onBackendSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  createBackendPending: boolean;
  createBackendError: boolean;
  createBackendSuccess: boolean;
  adminBackends: BackendConfig[];
  adminBackendsLoading: boolean;
  onEditBackend: (backend: BackendConfig) => void;
  onSyncBackend: (backendName: string) => void;
  onDeleteBackend: (backendName: string) => void;
  syncBackendPending: boolean;
  deleteBackendPending: boolean;
  editingProviderName: string | null;
  isProviderFormDirty: boolean;
  providerName: string;
  providerIssuer: string;
  providerClientId: string;
  providerClientSecret: string;
  providerScopes: string;
  providerClaimsRules: string;
  setProviderName: (value: string) => void;
  setProviderIssuer: (value: string) => void;
  setProviderClientId: (value: string) => void;
  setProviderClientSecret: (value: string) => void;
  setProviderScopes: (value: string) => void;
  setProviderClaimsRules: (value: string) => void;
  onResetProviderForm: () => void;
  onIdentityProviderSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  createIdentityProviderPending: boolean;
  createIdentityProviderError: boolean;
  createIdentityProviderSuccess: boolean;
  providerFormError: string | null;
  adminIdentityProviders: IdentityProviderConfig[];
  adminIdentityProvidersLoading: boolean;
  onEditIdentityProvider: (provider: IdentityProviderConfig) => void;
  onDeleteIdentityProvider: (providerName: string) => void;
  deleteIdentityProviderPending: boolean;
  isEditingCurrentUser: boolean;
  adminUsers: AdminUser[];
  selectedGrantUsername: string | null;
  selectedUserRole: "admin" | "editor" | "viewer";
  selectedAdminUserRole?: "admin" | "editor" | "viewer";
  setSelectedGrantUsername: (value: string) => void;
  setSelectedUserRole: (value: "admin" | "editor" | "viewer") => void;
  onRoleSubmit: () => void;
  updateUserRolePending: boolean;
  updateUserRoleError: boolean;
  updateUserRoleSuccess: boolean;
  isRoleChangeBlocked: boolean;
  zoneContextName: string | null;
  grantActions: string[];
  toggleGrantAction: (action: string) => void;
  onGrantSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  assignGrantPending: boolean;
  assignGrantError: boolean;
  assignGrantSuccess: boolean;
  adminZoneGrants: ZoneGrant[];
  adminZoneGrantsLoading: boolean;
};

const adminSectionOptions: Array<{
  key: AdminSection;
  label: string;
}> = [
  { key: "backends", label: "Backends" },
  { key: "identity", label: "Identity" },
  { key: "access", label: "Access" },
];

export function AdminConsole(props: AdminConsoleProps) {
  const scopedZoneGrants = props.zoneContextName
    ? props.adminZoneGrants.filter((grant) => grant.zoneName === props.zoneContextName)
    : props.adminZoneGrants;
  const showHeader = props.showHeader ?? true;

  return (
    <section className="panel admin-console">
      {showHeader ? (
        <>
          <div className="panel-heading">
            <div>
              <p className="panel-label">Admin console</p>
              <h2>Configuration surface</h2>
            </div>
            <span className="panel-meta">{props.activeSectionLabel}</span>
          </div>
          <p className="admin-console-copy">{props.activeSectionDescription}</p>
        </>
      ) : null}
      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        {adminSectionOptions.map((section) => (
          <button
            key={section.key}
            aria-selected={props.activeSection === section.key}
            className={`tab-button ${
              props.activeSection === section.key ? "tab-button-active" : ""
            }`}
            onClick={() => props.onSectionChange(section.key)}
            role="tab"
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>

      {props.activeSection === "backends" ? (
        <article className="admin-panel-body">
          <div className="panel-heading">
            <div>
              <p className="panel-label">Backend config</p>
              <h2>Backend configs</h2>
            </div>
            <span className="panel-meta">{props.adminBackends.length} configs</span>
          </div>
          <form className="stacked-form stacked-form-split" onSubmit={props.onBackendSubmit}>
            <div className="form-toolbar">
              <div>
                <strong>
                  {props.editingBackendName
                    ? `Editing ${props.editingBackendName}`
                    : "Create backend config"}
                </strong>
                <p className="helper-copy">
                  {props.editingBackendName
                    ? "Saving updates the selected backend config in place."
                    : "Register a backend so it can be synced and granted without touching the database."}
                </p>
              </div>
              {props.isBackendFormDirty ? (
                <button
                  className="primary-button secondary-button"
                  onClick={props.onResetBackendForm}
                  type="button"
                >
                  Reset form
                </button>
              ) : null}
            </div>
            <label>
              <span>Name</span>
              <input
                autoComplete="off"
                name="backend-name"
                onChange={(event) => props.setBackendName(event.target.value)}
                value={props.backendName}
              />
            </label>
            <label>
              <span>Backend type</span>
              <input
                autoComplete="off"
                name="backend-type"
                onChange={(event) => props.setBackendType(event.target.value)}
                value={props.backendType}
              />
            </label>
            <label>
              <span>Capabilities</span>
              <textarea
                name="backend-capabilities"
                onChange={(event) => props.setBackendCapabilities(event.target.value)}
                spellCheck={false}
                value={props.backendCapabilities}
              />
            </label>
            <p className="helper-copy">
              Capabilities are stored as a comma-separated list exactly as the backend
              advertises them.
            </p>
            <button
              className="primary-button"
              disabled={
                props.createBackendPending ||
                props.backendName.trim().length === 0 ||
                props.backendType.trim().length === 0
              }
              type="submit"
            >
              {props.createBackendPending
                ? "Saving..."
                : props.editingBackendName
                  ? "Update backend config"
                  : "Save backend config"}
            </button>
            {props.createBackendError ? (
              <p className="status-error">Backend config could not be saved.</p>
            ) : null}
            {props.createBackendSuccess ? (
              <p className="status-success">Backend config saved.</p>
            ) : null}
          </form>
          {props.adminBackendsLoading ? (
            <p className="placeholder-copy">Loading backend configs...</p>
          ) : null}
          <ul className="resource-list">
            {props.adminBackends.map((backend) => (
              <li key={backend.name} className="resource-item-action backend-config-item">
                <div className="resource-copy backend-config-copy">
                  <div className="backend-config-heading">
                    <strong>{backend.name}</strong>
                    <span className="backend-config-type">{backend.backendType}</span>
                  </div>
                  <span className="backend-config-capabilities">
                    {backend.capabilities.join(", ")}
                  </span>
                </div>
                <div className="inline-actions backend-config-actions">
                  <button
                    className="primary-button secondary-button"
                    onClick={() => props.onEditBackend(backend)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="primary-button secondary-button"
                    disabled={props.syncBackendPending}
                    onClick={() => props.onSyncBackend(backend.name)}
                    type="button"
                  >
                    {props.syncBackendPending ? "Syncing..." : "Sync zones"}
                  </button>
                  <button
                    className="primary-button secondary-button secondary-button-danger"
                    disabled={props.deleteBackendPending}
                    onClick={() => props.onDeleteBackend(backend.name)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!props.adminBackendsLoading && props.adminBackends.length === 0 ? (
            <p className="placeholder-copy">No backend configs have been registered yet.</p>
          ) : null}
        </article>
      ) : null}

      {props.activeSection === "identity" ? (
        <article className="admin-panel-body">
          <div className="panel-heading">
            <div>
              <p className="panel-label">Identity</p>
              <h2>OIDC configs</h2>
            </div>
            <span className="panel-meta">{props.adminIdentityProviders.length} providers</span>
          </div>
          <form
            className="stacked-form stacked-form-split"
            onSubmit={props.onIdentityProviderSubmit}
          >
            <div className="form-toolbar">
              <div>
                <strong>
                  {props.editingProviderName
                    ? `Editing ${props.editingProviderName}`
                    : "Create OIDC provider"}
                </strong>
                <p className="helper-copy">
                  {props.editingProviderName
                    ? "Leave the client secret blank to keep the current stored secret."
                    : "Register an OIDC provider with claims mapping rules for role and grant sync."}
                </p>
              </div>
              {props.isProviderFormDirty ? (
                <button
                  className="primary-button secondary-button"
                  onClick={props.onResetProviderForm}
                  type="button"
                >
                  Reset form
                </button>
              ) : null}
            </div>
            <label>
              <span>Name</span>
              <input
                autoComplete="off"
                name="provider-name"
                onChange={(event) => props.setProviderName(event.target.value)}
                value={props.providerName}
              />
            </label>
            <label>
              <span>Issuer</span>
              <input
                autoComplete="url"
                name="provider-issuer"
                onChange={(event) => props.setProviderIssuer(event.target.value)}
                value={props.providerIssuer}
              />
            </label>
            <label>
              <span>Client ID</span>
              <input
                autoComplete="off"
                name="provider-client-id"
                onChange={(event) => props.setProviderClientId(event.target.value)}
                value={props.providerClientId}
              />
            </label>
            <label>
              <span>Client secret</span>
              <input
                autoComplete="new-password"
                name="provider-client-secret"
                onChange={(event) => props.setProviderClientSecret(event.target.value)}
                type="password"
                value={props.providerClientSecret}
              />
            </label>
            <label>
              <span>Scopes</span>
              <textarea
                name="provider-scopes"
                onChange={(event) => props.setProviderScopes(event.target.value)}
                spellCheck={false}
                value={props.providerScopes}
              />
            </label>
            <label>
              <span>Claims mapping rules JSON</span>
              <textarea
                className="json-editor"
                name="provider-claims-rules"
                onChange={(event) => props.setProviderClaimsRules(event.target.value)}
                spellCheck={false}
                value={props.providerClaimsRules}
              />
            </label>
            <p className="helper-copy">
              The client secret is accepted on write but never shown again after save.
            </p>
            <button
              className="primary-button"
              disabled={
                props.createIdentityProviderPending ||
                props.providerName.trim().length === 0 ||
                (!props.editingProviderName &&
                  props.providerClientSecret.trim().length === 0)
              }
              type="submit"
            >
              {props.createIdentityProviderPending
                ? "Saving..."
                : props.editingProviderName
                  ? "Update OIDC config"
                  : "Save OIDC config"}
            </button>
            {props.createIdentityProviderError ? (
              <p className="status-error">
                Identity provider config could not be saved.
              </p>
            ) : null}
            {props.createIdentityProviderSuccess ? (
              <p className="status-success">Identity provider config saved.</p>
            ) : null}
            {props.providerFormError ? (
              <p className="status-error">{props.providerFormError}</p>
            ) : null}
          </form>
          {props.adminIdentityProvidersLoading ? (
            <p className="placeholder-copy">Loading identity providers...</p>
          ) : null}
          <ul className="resource-list">
            {props.adminIdentityProviders.map((provider) => (
              <li key={provider.name} className="resource-item-action">
                <div className="resource-copy">
                  <strong>{provider.name}</strong>
                  <span>
                    {provider.issuer} · scopes: {provider.scopes.join(", ")} ·{" "}
                    {provider.hasClientSecret ? "secret configured" : "no secret"}
                  </span>
                </div>
                <div className="inline-actions">
                  <button
                    className="primary-button secondary-button"
                    onClick={() => props.onEditIdentityProvider(provider)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="primary-button secondary-button"
                    disabled={props.deleteIdentityProviderPending}
                    onClick={() => props.onDeleteIdentityProvider(provider.name)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!props.adminIdentityProvidersLoading &&
          props.adminIdentityProviders.length === 0 ? (
            <p className="placeholder-copy">No identity providers have been configured yet.</p>
          ) : null}
        </article>
      ) : null}

      {props.activeSection === "access" ? (
        <article className="admin-panel-body">
          <div className="panel-heading">
            <div>
              <p className="panel-label">Access</p>
              <h2>Role bindings</h2>
            </div>
            <span className="panel-meta">{scopedZoneGrants.length} grants</span>
          </div>
          <form className="stacked-form stacked-form-split" onSubmit={props.onGrantSubmit}>
            <div className="status-callout">
              <strong>
                {props.zoneContextName
                  ? `Zone context: ${props.zoneContextName}`
                  : "Zone context not selected"}
              </strong>
              <p>
                {props.zoneContextName
                  ? "The selected workspace zone is reused here, so grants stay anchored to the same operational target."
                  : "Pick a zone in the workspace first, then open access controls from there."}
              </p>
            </div>
            {props.isEditingCurrentUser ? (
              <div className="status-callout status-callout-warning">
                <strong>Current session selected</strong>
                <p>
                  Zone grants can still be managed for your own account, but changing
                  your own global role is blocked from this screen to prevent accidental
                  lockout while testing.
                </p>
              </div>
            ) : null}
            <label>
              <span>User</span>
              <select
                aria-label="Grant user"
                onChange={(event) => props.setSelectedGrantUsername(event.target.value)}
                value={props.selectedGrantUsername ?? ""}
              >
                {props.adminUsers.map((user) => (
                  <option key={user.username} value={user.username}>
                    {user.username} · {user.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Global role</span>
              <select
                aria-label="User role"
                onChange={(event) =>
                  props.setSelectedUserRole(
                    event.target.value as "admin" | "editor" | "viewer",
                  )
                }
                value={props.selectedUserRole}
              >
                <option value="admin">admin</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
            </label>
            <button
              className="primary-button secondary-button"
              disabled={
                props.updateUserRolePending ||
                !props.selectedGrantUsername ||
                props.selectedAdminUserRole === props.selectedUserRole ||
                props.isRoleChangeBlocked
              }
              onClick={props.onRoleSubmit}
              type="button"
            >
              {props.updateUserRolePending ? "Saving role..." : "Save global role"}
            </button>
            {props.isRoleChangeBlocked ? (
              <p className="status-error">
                Select another operator to change global roles. Your own role cannot
                be changed from the active session.
              </p>
            ) : null}
            <fieldset className="action-group">
              <legend>Actions</legend>
              {["read", "write", "grant"].map((action) => (
                <label key={action} className="checkbox-line">
                  <span>{action}</span>
                  <input
                    checked={props.grantActions.includes(action)}
                    onChange={() => props.toggleGrantAction(action)}
                    type="checkbox"
                  />
                </label>
              ))}
            </fieldset>
            <button
              className="primary-button"
              disabled={
                props.assignGrantPending ||
                !props.selectedGrantUsername ||
                !props.zoneContextName ||
                props.grantActions.length === 0
              }
              type="submit"
            >
              {props.assignGrantPending ? "Saving grant..." : "Save zone grant"}
            </button>
            {!props.zoneContextName ? (
              <p className="status-error">
                Select a zone in the workspace before saving a zone grant.
              </p>
            ) : null}
            {props.assignGrantError ? (
              <p className="status-error">Zone grant could not be saved.</p>
            ) : null}
            {props.assignGrantSuccess ? (
              <p className="status-success">Zone grant saved.</p>
            ) : null}
            {props.updateUserRoleError ? (
              <p className="status-error">User role could not be updated.</p>
            ) : null}
            {props.updateUserRoleSuccess ? (
              <p className="status-success">Global role updated.</p>
            ) : null}
          </form>
          {props.adminZoneGrantsLoading ? (
            <p className="placeholder-copy">Loading grants...</p>
          ) : null}
          <ul className="resource-list">
            {scopedZoneGrants.map((grant) => (
              <li key={`${grant.username}-${grant.zoneName}`}>
                <div className="resource-copy">
                  <strong>{grant.username}</strong>
                  <span>
                    {grant.zoneName} · {grant.actions.join(", ")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {!props.adminZoneGrantsLoading && scopedZoneGrants.length === 0 ? (
            <p className="placeholder-copy">
              {props.zoneContextName
                ? "No zone-level grants are stored for this zone yet."
                : "Pick a zone to inspect and manage grants from this drawer."}
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
