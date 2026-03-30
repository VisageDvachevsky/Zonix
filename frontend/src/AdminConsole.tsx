import { roleLabel, tr, type Locale } from "./uiText";

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
  locale: Locale;
  showHeader?: boolean;
  showTabs?: boolean;
  showSectionHeading?: boolean;
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
  onCreateBackend: () => void;
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
  onCreateProvider: () => void;
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
  isGrantChangeBlocked: boolean;
  zoneContextName: string | null;
  availableZoneNames: string[];
  setZoneContextName: (value: string) => void;
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
  const grantActionLabel = (action: string) => {
    if (props.locale !== "ru") {
      return action;
    }
    return (
      {
        read: "чтение",
        write: "запись",
        grant: "делегирование",
      }[action] ?? action
    );
  };
  const adminBackends = props.adminBackends ?? [];
  const adminIdentityProviders = props.adminIdentityProviders ?? [];
  const adminUsers = props.adminUsers ?? [];
  const adminZoneGrants = props.adminZoneGrants ?? [];
  const availableZoneNames = props.availableZoneNames ?? [];
  const grantActions = props.grantActions ?? [];
  const selectedBackendConfig =
    adminBackends.find((backend) => backend.name === props.editingBackendName) ?? null;
  const selectedIdentityProvider =
    adminIdentityProviders.find((provider) => provider.name === props.editingProviderName) ??
    null;
  const scopedZoneGrants = props.zoneContextName
    ? adminZoneGrants.filter((grant) => grant.zoneName === props.zoneContextName)
    : adminZoneGrants;
  const showHeader = props.showHeader ?? true;
  const showTabs = props.showTabs ?? true;
  const showSectionHeading = props.showSectionHeading ?? true;
  const isEditingBackend = Boolean(props.editingBackendName && selectedBackendConfig);
  const isEditingProvider = Boolean(props.editingProviderName && selectedIdentityProvider);

  return (
    <section className="panel admin-console">
      {showHeader ? (
        <>
          <div className="panel-heading">
            <div>
              <p className="panel-label">Admin console</p>
              <h2>{props.locale === "ru" ? "Поверхность настройки" : "Configuration surface"}</h2>
            </div>
            <span className="panel-meta">{props.activeSectionLabel}</span>
          </div>
          <p className="admin-console-copy">{props.activeSectionDescription}</p>
        </>
      ) : null}
      {showTabs ? (
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
      ) : null}

      {props.activeSection === "backends" ? (
        <article className="admin-panel-body">
          {showSectionHeading ? (
              <div className="panel-heading">
                <div>
                  <p className="panel-label">{props.locale === "ru" ? "Конфиг бэкенда" : "Backend config"}</p>
                  <h2>{props.locale === "ru" ? "Конфиги бэкендов" : "Backend configs"}</h2>
                </div>
              <span className="panel-meta">
                {props.locale === "ru" ? `${adminBackends.length} конфигов` : `${adminBackends.length} configs`}
              </span>
            </div>
          ) : null}
          <div className="admin-editor-layout">
            <section className="admin-editor-directory">
              <div className="panel-heading panel-heading-compact">
                <div>
                  <p className="panel-label">{props.locale === "ru" ? "Инвентарь" : "Inventory"}</p>
                  <h3>{props.locale === "ru" ? "Зарегистрированные бэкенды" : "Registered backends"}</h3>
                </div>
                <button
                  className="secondary-button"
                  onClick={props.onCreateBackend}
                  type="button"
                >
                  {props.locale === "ru" ? "Новый конфиг" : "New config"}
                </button>
              </div>
              {props.adminBackendsLoading ? (
                <p className="placeholder-copy">{props.locale === "ru" ? "Загрузка конфигов бэкендов…" : "Loading backend configs…"}</p>
              ) : adminBackends.length === 0 ? (
                <p className="placeholder-copy">{props.locale === "ru" ? "Конфиги бэкендов ещё не зарегистрированы." : "No backend configs have been registered yet."}</p>
              ) : (
                <div className="admin-resource-list">
                  {adminBackends.map((backend) => {
                    const discoveryEnabled = backend.capabilities.includes("discoverZones");
                    const isActive = selectedBackendConfig?.name === backend.name;
                    return (
                      <button
                        key={backend.name}
                        className={`admin-resource-card ${
                          isActive ? "admin-resource-card-active" : ""
                        }`}
                        onClick={() => props.onEditBackend(backend)}
                        type="button"
                      >
                        <div className="admin-resource-card-top">
                          <div className="admin-resource-card-copy">
                            <span className="admin-resource-kicker">{backend.backendType}</span>
                            <strong>{backend.name}</strong>
                          </div>
                          <span
                            className={`status-pill ${
                              discoveryEnabled ? "status-pill-success" : ""
                            }`}
                          >
                          {discoveryEnabled ? tr(props.locale, "Discovery") : tr(props.locale, "Manual")}
                        </span>
                      </div>
                        <p className="admin-resource-summary">
                          {props.locale === "ru"
                            ? `${backend.capabilities.length} ${backend.capabilities.length === 1 ? "возможность" : backend.capabilities.length < 5 ? "возможности" : "возможностей"}`
                            : `${backend.capabilities.length} capabilit${backend.capabilities.length === 1 ? "y" : "ies"}`}
                        </p>
                        <div className="admin-resource-badges">
                          {backend.capabilities.slice(0, 3).map((capability) => (
                            <span key={capability}>{tr(props.locale, capability)}</span>
                          ))}
                          {backend.capabilities.length > 3 ? (
                            <span>
                              {props.locale === "ru"
                                ? `+${backend.capabilities.length - 3} ещё`
                                : `+${backend.capabilities.length - 3} more`}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="admin-editor-workspace">
              <div
                key={`backend-workspace-${props.editingBackendName ?? "new"}`}
                className="admin-workspace-hero admin-editor-hero workspace-animate"
              >
                <div className="admin-workspace-hero-copy">
                  <span className="admin-resource-kicker">
                    {isEditingBackend ? (props.locale === "ru" ? "Рабочая область бэкенда" : "Backend workspace") : (props.locale === "ru" ? "Режим создания" : "Create mode")}
                  </span>
                  <strong>
                    {isEditingBackend
                      ? props.locale === "ru"
                        ? `Редактирование ${props.editingBackendName}`
                        : `Editing ${props.editingBackendName}`
                      : props.locale === "ru"
                        ? "Создать конфиг бэкенда"
                        : "Create backend config"}
                  </strong>
                  <p>
                    {isEditingBackend
                      ? props.locale === "ru"
                        ? "Сохранение обновит выбранный конфиг бэкенда прямо на месте."
                        : "Saving updates the selected backend config in place."
                      : props.locale === "ru"
                        ? "Зарегистрируйте бэкенд, чтобы обнаружение, синхронизация и права на зоны жили внутри панели."
                        : "Register a backend so discovery, sync, and zone grants stay inside the control plane."}
                  </p>
                </div>
                <div className="admin-resource-badges">
                  {selectedBackendConfig && isEditingBackend ? (
                    <>
                      <span>{selectedBackendConfig.backendType}</span>
                      <span>
                        {selectedBackendConfig.capabilities.includes("discoverZones")
                          ? props.locale === "ru"
                            ? "С поддержкой обнаружения"
                            : "Discovery-capable"
                          : props.locale === "ru"
                            ? "Ручная регистрация"
                            : "Manual registration"}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>{props.locale === "ru" ? "Новый бэкенд" : "New backend"}</span>
                      <span>{props.locale === "ru" ? "Черновик inventory" : "Inventory draft"}</span>
                    </>
                  )}
                </div>
              </div>

              <div
                key={`backend-form-${props.editingBackendName ?? "new"}`}
                className="admin-form-shell workspace-animate"
              >
                <form className="stacked-form stacked-form-split" onSubmit={props.onBackendSubmit}>
                  <div className="form-toolbar">
                    <div>
                      <strong>{props.locale === "ru" ? "Параметры бэкенда" : "Backend details"}</strong>
                      <p className="helper-copy">
                        {props.locale === "ru"
                          ? "Возможности сохраняются как список через запятую ровно в том виде, как их объявляет бэкенд."
                          : "Capabilities are stored as a comma-separated list exactly as the backend advertises them."}
                      </p>
                    </div>
                    {props.isBackendFormDirty ? (
                      <button
                        className="secondary-button"
                        onClick={props.onResetBackendForm}
                        type="button"
                      >
                        {tr(props.locale, "Reset form")}
                      </button>
                    ) : null}
                  </div>
                  <label>
                    <span>{tr(props.locale, "Name")}</span>
                    <input
                      autoComplete="off"
                      name="backend-name"
                      onChange={(event) => props.setBackendName(event.target.value)}
                      value={props.backendName}
                    />
                  </label>
                  <label>
                    <span>{props.locale === "ru" ? "Тип бэкенда" : "Backend type"}</span>
                    <input
                      autoComplete="off"
                      name="backend-type"
                      onChange={(event) => props.setBackendType(event.target.value)}
                      value={props.backendType}
                    />
                  </label>
                  <label className="form-field-span-2">
                    <span>{tr(props.locale, "Capabilities")}</span>
                    <textarea
                      name="backend-capabilities"
                      onChange={(event) => props.setBackendCapabilities(event.target.value)}
                      spellCheck={false}
                      value={props.backendCapabilities}
                    />
                  </label>
                  <div className="admin-workspace-actions">
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
                        ? props.locale === "ru"
                          ? "Сохранение…"
                          : "Saving…"
                        : isEditingBackend
                          ? props.locale === "ru"
                            ? "Обновить конфиг бэкенда"
                            : "Update backend config"
                          : props.locale === "ru"
                            ? "Сохранить конфиг бэкенда"
                            : "Save backend config"}
                    </button>
                    {selectedBackendConfig && isEditingBackend ? (
                      <>
                        <button
                          className="secondary-button"
                          disabled={
                            props.syncBackendPending ||
                            !selectedBackendConfig.capabilities.includes("discoverZones")
                          }
                          onClick={() => props.onSyncBackend(selectedBackendConfig.name)}
                          type="button"
                        >
                          {props.syncBackendPending ? (props.locale === "ru" ? "Синхронизация…" : "Syncing…") : tr(props.locale, "Sync zones")}
                        </button>
                        <button
                          className="secondary-button secondary-button-danger"
                          disabled={props.deleteBackendPending}
                          onClick={() => props.onDeleteBackend(selectedBackendConfig.name)}
                          type="button"
                        >
                          {props.locale === "ru" ? "Удалить конфиг" : "Delete config"}
                        </button>
                      </>
                    ) : null}
                  </div>
                  {selectedBackendConfig &&
                  isEditingBackend &&
                  !selectedBackendConfig.capabilities.includes("discoverZones") ? (
                    <div className="status-callout">
                      <strong>{props.locale === "ru" ? "Бэкенд только для ручного режима" : "Manual-only backend"}</strong>
                      <p>{props.locale === "ru" ? "Обнаружение и синхронизация остаются выключенными, пока бэкенд не объявит поддержку discovery." : "Discovery and sync stay disabled until this backend advertises discovery support."}</p>
                    </div>
                  ) : null}
                  {props.createBackendError ? (
                    <p className="status-error">
                      {props.locale === "ru"
                        ? "Не удалось сохранить конфиг бэкенда. Проверьте имя, тип и список возможностей, затем повторите попытку."
                        : "Backend config could not be saved. Check the name, type, and capability list, then retry."}
                    </p>
                  ) : null}
                  {props.createBackendSuccess ? (
                    <p className="status-success">{props.locale === "ru" ? "Конфиг бэкенда сохранён." : "Backend config saved."}</p>
                  ) : null}
                </form>
              </div>
            </section>
          </div>
        </article>
      ) : null}

      {props.activeSection === "identity" ? (
        <article className="admin-panel-body">
          {showSectionHeading ? (
              <div className="panel-heading">
                <div>
                  <p className="panel-label">{props.locale === "ru" ? "Идентификация" : "Identity"}</p>
                  <h2>{props.locale === "ru" ? "OIDC-конфиги" : "OIDC configs"}</h2>
                </div>
              <span className="panel-meta">
                {props.locale === "ru"
                  ? `${adminIdentityProviders.length} провайдеров`
                  : `${adminIdentityProviders.length} providers`}
              </span>
            </div>
          ) : null}
          <div className="admin-editor-layout">
            <section className="admin-editor-directory">
              <div className="panel-heading panel-heading-compact">
                <div>
                  <p className="panel-label">{tr(props.locale, "Directory")}</p>
                  <h3>{props.locale === "ru" ? "Настроенные провайдеры" : "Configured providers"}</h3>
                </div>
                <button
                  className="secondary-button"
                  onClick={props.onCreateProvider}
                  type="button"
                >
                  {tr(props.locale, "New provider")}
                </button>
              </div>
              {props.adminIdentityProvidersLoading ? (
                <p className="placeholder-copy">
                  {props.locale === "ru" ? "Загрузка провайдеров идентификации…" : "Loading identity providers…"}
                </p>
              ) : adminIdentityProviders.length === 0 ? (
                <p className="placeholder-copy">
                  {props.locale === "ru"
                    ? "Провайдеры идентификации ещё не настроены."
                    : "No identity providers have been configured yet."}
                </p>
              ) : (
                <div className="admin-resource-list">
                  {adminIdentityProviders.map((provider) => {
                    const isActive = selectedIdentityProvider?.name === provider.name;
                    return (
                      <button
                        key={provider.name}
                        className={`admin-resource-card ${
                          isActive ? "admin-resource-card-active" : ""
                        }`}
                        onClick={() => props.onEditIdentityProvider(provider)}
                        type="button"
                      >
                        <div className="admin-resource-card-top">
                          <div className="admin-resource-card-copy">
                            <span className="admin-resource-kicker">{props.locale === "ru" ? "OIDC-провайдер" : "OIDC provider"}</span>
                            <strong>{provider.name}</strong>
                          </div>
                          <span
                            className={`status-pill ${
                              provider.hasClientSecret ? "status-pill-success" : ""
                            }`}
                          >
                            {provider.hasClientSecret
                              ? props.locale === "ru"
                                ? "Секрет задан"
                                : "Secret set"
                              : props.locale === "ru"
                                ? "Секрет не задан"
                                : "Secret missing"}
                          </span>
                        </div>
                        <p className="admin-resource-summary">{provider.issuer}</p>
                        <div className="admin-resource-badges">
                          {provider.scopes.slice(0, 3).map((scope) => (
                            <span key={scope}>{scope}</span>
                          ))}
                          {provider.scopes.length > 3 ? (
                            <span>
                              {props.locale === "ru"
                                ? `+${provider.scopes.length - 3} ещё`
                                : `+${provider.scopes.length - 3} more`}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="admin-editor-workspace">
              <div
                key={`provider-workspace-${props.editingProviderName ?? "new"}`}
                className="admin-workspace-hero admin-editor-hero workspace-animate"
              >
                <div className="admin-workspace-hero-copy">
                  <span className="admin-resource-kicker">
                    {isEditingProvider ? (props.locale === "ru" ? "Рабочая область провайдера" : "Provider workspace") : (props.locale === "ru" ? "Режим создания" : "Create mode")}
                  </span>
                  <strong>
                    {isEditingProvider
                      ? props.locale === "ru"
                        ? `Редактирование ${props.editingProviderName}`
                        : `Editing ${props.editingProviderName}`
                      : props.locale === "ru"
                        ? "Создать OIDC-провайдер"
                        : "Create OIDC provider"}
                  </strong>
                  <p>
                    {isEditingProvider
                      ? props.locale === "ru"
                        ? "Оставьте секрет клиента пустым, чтобы сохранить уже записанный секрет без изменений."
                        : "Leave the client secret blank to keep the stored secret in place."
                      : props.locale === "ru"
                        ? "Зарегистрируйте OIDC-провайдер и задайте правила маппинга claims для ролей и синхронизации прав."
                        : "Register an OIDC provider with claims mapping rules for role and grant sync."}
                  </p>
                </div>
                <div className="admin-resource-badges">
                  {selectedIdentityProvider && isEditingProvider ? (
                    <>
                      <span>
                        {props.locale === "ru"
                          ? `${selectedIdentityProvider.scopes.length} ${selectedIdentityProvider.scopes.length === 1 ? "область доступа" : "области доступа"}`
                          : `${selectedIdentityProvider.scopes.length} scopes`}
                      </span>
                      <span>
                        {selectedIdentityProvider.hasClientSecret
                          ? props.locale === "ru"
                            ? "Секрет задан"
                            : "Secret configured"
                          : props.locale === "ru"
                            ? "Нужен секрет"
                            : "Needs secret"}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>{tr(props.locale, "New provider")}</span>
                      <span>{props.locale === "ru" ? "OIDC-черновик" : "OIDC draft"}</span>
                    </>
                  )}
                </div>
              </div>

              <div
                key={`provider-form-${props.editingProviderName ?? "new"}`}
                className="admin-form-shell workspace-animate"
              >
                <form
                  className="stacked-form stacked-form-split"
                  onSubmit={props.onIdentityProviderSubmit}
                >
                  <div className="form-toolbar">
                    <div>
                      <strong>{tr(props.locale, "Provider details")}</strong>
                      <p className="helper-copy">
                        {props.locale === "ru"
                          ? "Секрет клиента принимается при записи, но после сохранения больше никогда не показывается."
                          : "The client secret is accepted on write but never shown again after save."}
                      </p>
                    </div>
                    {props.isProviderFormDirty ? (
                      <button
                        className="secondary-button"
                        onClick={props.onResetProviderForm}
                        type="button"
                      >
                        {tr(props.locale, "Reset form")}
                      </button>
                    ) : null}
                  </div>
                  <label>
                    <span>{tr(props.locale, "Name")}</span>
                    <input
                      autoComplete="off"
                      name="provider-name"
                      onChange={(event) => props.setProviderName(event.target.value)}
                      value={props.providerName}
                    />
                  </label>
                  <label>
                    <span>{tr(props.locale, "Issuer")}</span>
                    <input
                      autoComplete="url"
                      name="provider-issuer"
                      onChange={(event) => props.setProviderIssuer(event.target.value)}
                      value={props.providerIssuer}
                    />
                  </label>
                  <label>
                    <span>{tr(props.locale, "Client ID")}</span>
                    <input
                      autoComplete="off"
                      name="provider-client-id"
                      onChange={(event) => props.setProviderClientId(event.target.value)}
                      value={props.providerClientId}
                    />
                  </label>
                  <label>
                    <span>{props.locale === "ru" ? "Секрет клиента" : tr(props.locale, "Client secret")}</span>
                    <input
                      autoComplete="new-password"
                      name="provider-client-secret"
                      onChange={(event) => props.setProviderClientSecret(event.target.value)}
                      type="password"
                      value={props.providerClientSecret}
                    />
                  </label>
                  <label className="form-field-span-2">
                    <span>{props.locale === "ru" ? "Области доступа" : tr(props.locale, "Scopes")}</span>
                    <textarea
                      name="provider-scopes"
                      onChange={(event) => props.setProviderScopes(event.target.value)}
                      spellCheck={false}
                      value={props.providerScopes}
                    />
                  </label>
                  <label className="form-field-span-2">
                    <span>{tr(props.locale, "Claims mapping rules JSON")}</span>
                    <textarea
                      className="json-editor"
                      name="provider-claims-rules"
                      onChange={(event) => props.setProviderClaimsRules(event.target.value)}
                      spellCheck={false}
                      value={props.providerClaimsRules}
                    />
                  </label>
                  <div className="admin-workspace-actions">
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
                        ? props.locale === "ru"
                          ? "Сохранение…"
                          : "Saving…"
                        : isEditingProvider
                          ? props.locale === "ru"
                            ? "Обновить OIDC-конфиг"
                            : "Update OIDC config"
                          : props.locale === "ru"
                            ? "Сохранить OIDC-конфиг"
                            : "Save OIDC config"}
                    </button>
                    {selectedIdentityProvider && isEditingProvider ? (
                      <button
                        className="secondary-button secondary-button-danger"
                        disabled={props.deleteIdentityProviderPending}
                        onClick={() => props.onDeleteIdentityProvider(selectedIdentityProvider.name)}
                        type="button"
                      >
                        {tr(props.locale, "Delete provider")}
                      </button>
                    ) : null}
                  </div>
                  {props.createIdentityProviderError ? (
                    <p className="status-error">
                      {props.locale === "ru"
                        ? "Не удалось сохранить конфиг провайдера. Проверьте адрес issuer, поля клиента и JSON маппинга."
                        : "Identity provider config could not be saved. Validate issuer URL, client fields, and mapping JSON."}
                    </p>
                  ) : null}
                  {props.createIdentityProviderSuccess ? (
                    <p className="status-success">{props.locale === "ru" ? "Конфиг провайдера сохранён." : "Identity provider config saved."}</p>
                  ) : null}
                  {props.providerFormError ? (
                    <p className="status-error">{props.providerFormError}</p>
                  ) : null}
                </form>
              </div>
            </section>
          </div>
        </article>
      ) : null}

      {props.activeSection === "access" ? (
        <article className="admin-panel-body">
          {showSectionHeading ? (
            <div className="panel-heading">
              <div>
                <p className="panel-label">{tr(props.locale, "Access")}</p>
                <h2>{tr(props.locale, "Role bindings")}</h2>
              </div>
              <span className="panel-meta">{scopedZoneGrants.length} grants</span>
            </div>
          ) : null}
          <form className="stacked-form admin-access-form" onSubmit={props.onGrantSubmit}>
              <div className="status-callout">
                <strong>
                  {props.zoneContextName
                  ? props.locale === "ru"
                    ? `Контекст зоны: ${props.zoneContextName}`
                    : `Zone context: ${props.zoneContextName}`
                  : props.locale === "ru"
                    ? "Контекст зоны не выбран"
                    : "Zone context not selected"}
              </strong>
              <p>
                {props.zoneContextName
                  ? props.locale === "ru"
                    ? "Выбранная зона переиспользуется здесь, чтобы права оставались привязаны к тому же операционному объекту."
                    : "The selected zone is reused here so grants stay anchored to the same operational target."
                  : props.locale === "ru"
                    ? "Выберите зону в селекторе ниже, прежде чем сохранять право уровня зоны."
                    : "Choose a zone from the selector below before saving a zone-level grant."}
              </p>
            </div>
            {props.isEditingCurrentUser ? (
              <div className="status-callout status-callout-warning">
                <strong>{props.locale === "ru" ? "Выбрана текущая сессия" : "Current session selected"}</strong>
                <p>
                  {props.locale === "ru"
                    ? "Смена собственной глобальной роли здесь заблокирована, чтобы вы не потеряли доступ во время проверки."
                    : "Changing your own global role is blocked from this screen to prevent accidental lockout while testing."}
                </p>
              </div>
            ) : null}
            {props.isGrantChangeBlocked ? (
              <div className="status-callout">
                <strong>{tr(props.locale, "Zone grants not needed")}</strong>
                <p>
                  {props.locale === "ru"
                    ? "Админские аккаунты уже имеют полный доступ ко всем зонам. Zone grants нужны только editor и viewer аккаунтам."
                    : "Admin accounts already have full zone access. Zone grants only apply to editor and viewer accounts."}
                </p>
              </div>
            ) : null}
            <div className="admin-access-sections">
              <section className="admin-access-section">
                <div className="admin-access-section-head">
                  <div>
                    <p className="panel-label">{tr(props.locale, "Global role")}</p>
                    <h3>{tr(props.locale, "Baseline permissions")}</h3>
                  </div>
                  <span className="panel-meta">{tr(props.locale, "applies everywhere")}</span>
                </div>
                <div className="admin-access-fields">
                  <label>
                    <span>{tr(props.locale, "User")}</span>
                    <select
                      aria-label={props.locale === "ru" ? "Пользователь для назначения" : "Grant user"}
                      onChange={(event) => props.setSelectedGrantUsername(event.target.value)}
                      value={props.selectedGrantUsername ?? ""}
                    >
                      {adminUsers.map((user) => (
                        <option key={user.username} value={user.username}>
                          {user.username} · {roleLabel(props.locale, user.role)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{tr(props.locale, "Global role")}</span>
                    <select
                      aria-label={props.locale === "ru" ? "Глобальная роль пользователя" : "User role"}
                      onChange={(event) =>
                        props.setSelectedUserRole(
                          event.target.value as "admin" | "editor" | "viewer",
                        )
                      }
                      value={props.selectedUserRole}
                    >
                      <option value="admin">{roleLabel(props.locale, "admin")}</option>
                      <option value="editor">{roleLabel(props.locale, "editor")}</option>
                      <option value="viewer">{roleLabel(props.locale, "viewer")}</option>
                    </select>
                  </label>
                </div>
                <div className="admin-access-section-actions">
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
                    {props.updateUserRolePending
                      ? props.locale === "ru"
                        ? "Сохранение роли…"
                        : "Saving role…"
                      : tr(props.locale, "Save global role")}
                  </button>
                </div>
                {props.isRoleChangeBlocked ? (
                  <p className="status-error">
                    {props.locale === "ru"
                      ? "Выберите другого оператора для смены глобальной роли. Роль активной сессии отсюда менять нельзя."
                      : "Select another operator to change global roles. Your own role cannot be changed from the active session."}
                  </p>
                ) : null}
              </section>

              <section className="admin-access-section">
                <div className="admin-access-section-head">
                  <div>
                    <p className="panel-label">{tr(props.locale, "Zone grant")}</p>
                    <h3>{tr(props.locale, "Scoped overrides")}</h3>
                  </div>
                  <span className="panel-meta">{tr(props.locale, "only when needed")}</span>
                </div>
                <div className="admin-access-fields">
                  <label>
                    <span>{tr(props.locale, "Zone")}</span>
                    <select
                      aria-label={props.locale === "ru" ? "Зона для назначения" : "Grant zone"}
                      disabled={availableZoneNames.length === 0}
                      onChange={(event) => props.setZoneContextName(event.target.value)}
                      value={props.zoneContextName ?? ""}
                    >
                      {availableZoneNames.length === 0 ? (
                        <option value="">{tr(props.locale, "No zones available")}</option>
                      ) : null}
                      {availableZoneNames.map((zoneName) => (
                        <option key={zoneName} value={zoneName}>
                          {zoneName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <fieldset className="action-group grant-action-group">
                  <legend>{tr(props.locale, "Actions")}</legend>
                  {["read", "write", "grant"].map((action) => (
                    <label key={action} className="checkbox-line">
                      <span>{grantActionLabel(action)}</span>
                      <input
                        checked={grantActions.includes(action)}
                        onChange={() => props.toggleGrantAction(action)}
                        type="checkbox"
                      />
                    </label>
                  ))}
                </fieldset>
                <div className="admin-access-section-actions">
                  <button
                    className="primary-button"
                    disabled={
                      props.assignGrantPending ||
                      !props.selectedGrantUsername ||
                      !props.zoneContextName ||
                      grantActions.length === 0 ||
                      props.isGrantChangeBlocked
                    }
                    type="submit"
                  >
                    {props.assignGrantPending
                      ? props.locale === "ru"
                        ? "Сохранение прав…"
                        : "Saving grant…"
                      : tr(props.locale, "Save zone grant")}
                  </button>
                </div>
                {!props.zoneContextName ? (
                  <p className="status-error">
                    {props.locale === "ru"
                      ? "Выберите зону в рабочей области, прежде чем сохранять право уровня зоны."
                      : "Select a zone in the workspace before saving a zone grant."}
                  </p>
                ) : null}
                {props.isGrantChangeBlocked ? (
                  <p className="status-error">
                    {props.locale === "ru"
                      ? "Для управления правами уровня зоны выберите не-админский аккаунт."
                      : "Choose a non-admin account to manage zone-level grants."}
                  </p>
                ) : null}
              </section>
            </div>
            {props.assignGrantError ? (
              <p className="status-error">
                {props.locale === "ru"
                  ? "Не удалось сохранить право на зону. Проверьте пользователя, зону и выбранные действия, затем повторите попытку."
                  : "Zone grant could not be saved. Check the user, zone, and selected actions, then retry."}
              </p>
            ) : null}
            {props.assignGrantSuccess ? (
              <p className="status-success">{props.locale === "ru" ? "Права на зону сохранены." : "Zone grant saved."}</p>
            ) : null}
            {props.updateUserRoleError ? (
              <p className="status-error">
                {props.locale === "ru"
                  ? "Не удалось обновить роль пользователя. Обновите каталог и повторите попытку."
                  : "User role could not be updated. Refresh the directory and retry."}
              </p>
            ) : null}
            {props.updateUserRoleSuccess ? (
              <p className="status-success">{props.locale === "ru" ? "Глобальная роль обновлена." : "Global role updated."}</p>
            ) : null}
          </form>
          {props.adminZoneGrantsLoading ? (
            <p className="placeholder-copy">{tr(props.locale, "Loading grants…")}</p>
          ) : null}
          <ul className="resource-list grant-summary-list">
            {scopedZoneGrants.map((grant) => (
              <li key={`${grant.username}-${grant.zoneName}`} className="grant-summary-item">
                <div className="resource-copy">
                  <strong>{grant.username}</strong>
                  <span>
                    {grant.zoneName} · {grant.actions.map((action) => grantActionLabel(action)).join(", ")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {!props.adminZoneGrantsLoading && scopedZoneGrants.length === 0 ? (
            <p className="placeholder-copy">
              {props.zoneContextName
                ? props.locale === "ru"
                  ? "Для этой зоны ещё не сохранено ни одного права уровня зоны."
                  : "No zone-level grants are stored for this zone yet."
                : props.locale === "ru"
                  ? "Выберите зону, чтобы просматривать и управлять правами из этой панели."
                  : "Pick a zone to inspect and manage grants from this drawer."}
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
