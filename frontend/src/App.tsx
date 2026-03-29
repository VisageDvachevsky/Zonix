import {
  FormEvent,
  startTransition,
  useEffect,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  applyBulkZoneChanges,
  assignAdminZoneGrant,
  createAdminBackend,
  createAdminIdentityProvider,
  createAdminServiceAccount,
  createAdminServiceAccountToken,
  createZoneRecord,
  deleteAdminBackend,
  deleteAdminIdentityProvider,
  deleteZoneRecord,
  discoverAdminBackendZones,
  fetchAdminBackends,
  fetchAdminIdentityProviders,
  fetchAdminServiceAccounts,
  fetchAdminUsers,
  fetchAdminZoneGrants,
  fetchAuthSettings,
  fetchBackends,
  fetchHealth,
  fetchOidcProviders,
  fetchSession,
  fetchZoneRecords,
  fetchZones,
  importAdminBackendZones,
  login,
  logout,
  recordTypeSchema,
  startOidcLogin,
  syncAdminBackendZones,
  updateAdminUserRole,
  updateZoneRecord,
  type Backend,
  type AdminUser,
  type ApiTokenCreateResponse,
  type OidcProvider,
  type RecordSet,
  type RecordType,
  type Zone,
} from "./api";
import { AdminConsole } from "./AdminConsole";
import "./styles.css";

type AdminSection = "backends" | "identity" | "access";
type WorkspaceTab = "records" | "operations" | "access" | "auth";
type SortKey = "name" | "type" | "ttl";
type SortDirection = "asc" | "desc";
type RowFeedback = {
  key: string;
  kind: "error" | "success" | "info";
  message: string;
};
type RecordEditorState = {
  mode: "create" | "update";
  sourceKey: string;
  name: string;
  recordType: RecordType;
  ttl: string;
  valuesText: string;
  version?: string;
};

const draftRowKey = "__draft__";
const emptyAdminUsers: AdminUser[] = [];
const emptyBackends: Backend[] = [];
const emptyOidcProviders: OidcProvider[] = [];
const emptyRecords: RecordSet[] = [];
const emptyZones: Zone[] = [];
const recordTypeOptions = recordTypeSchema.options as readonly RecordType[];
const workspaceTabs: Array<{ key: WorkspaceTab; label: string }> = [
  { key: "records", label: "Records" },
  { key: "operations", label: "Operations" },
  { key: "access", label: "Access" },
  { key: "auth", label: "Auth" },
];
const adminSectionMeta: Record<
  AdminSection,
  { label: string; description: string }
> = {
  backends: {
    label: "Operations",
    description:
      "Register backends, inspect capabilities, and run backend-level sync.",
  },
  access: {
    label: "Access",
    description: "Manage roles and zone-level grants without leaving the workspace.",
  },
  identity: {
    label: "Auth",
    description:
      "Review auth hardening state and manage external identity providers.",
  },
};

function normalizeCommaSeparatedList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleAction(actions: string[], action: string) {
  return actions.includes(action)
    ? actions.filter((item) => item !== action)
    : [...actions, action];
}

function getRecordKey(record: Pick<RecordSet, "name" | "recordType">) {
  return `${record.name}:${record.recordType}`;
}

function createEmptyEditor(): RecordEditorState {
  return {
    mode: "create",
    sourceKey: draftRowKey,
    name: "@",
    recordType: "A",
    ttl: "300",
    valuesText: "",
  };
}

function createEditorFromRecord(
  record: RecordSet,
  mode: "create" | "update",
): RecordEditorState {
  return {
    mode,
    sourceKey: mode === "create" ? draftRowKey : getRecordKey(record),
    name: record.name,
    recordType: record.recordType,
    ttl: String(record.ttl),
    valuesText: record.values.join("\n"),
    version: mode === "update" ? record.version : undefined,
  };
}

function parseRecordValues(valuesText: string) {
  return valuesText
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function sortRecords(
  records: RecordSet[],
  sortKey: SortKey,
  sortDirection: SortDirection,
) {
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...records].sort((left, right) => {
    if (sortKey === "ttl") {
      return (left.ttl - right.ttl) * direction;
    }

    const leftValue =
      sortKey === "name" ? left.name.toLowerCase() : left.recordType.toLowerCase();
    const rightValue =
      sortKey === "name"
        ? right.name.toLowerCase()
        : right.recordType.toLowerCase();

    return leftValue.localeCompare(rightValue) * direction;
  });
}

function getSyncLabel(
  syncState: string | null | undefined,
  isSyncingBackend: boolean,
  syncError: boolean,
) {
  if (isSyncingBackend) return "pending";
  if (syncError) return "error";
  return syncState ?? "unknown";
}

function getFeedbackText(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function formatValueCount(count: number) {
  return `${count} ${count === 1 ? "value" : "values"}`;
}

function getRecordsAccessLabel(params: {
  canWriteRecords: boolean;
  hasSelectedBackend: boolean;
  role?: "admin" | "editor" | "viewer";
}) {
  if (!params.hasSelectedBackend) return "no backend";
  if (params.canWriteRecords) return "read/write";
  if (params.role === "viewer") return "viewer";
  return "read-only";
}

type RecordEditorRowProps = {
  canWrite: boolean;
  editor: RecordEditorState;
  feedback: RowFeedback | null;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (next: RecordEditorState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function RecordEditorRow(props: RecordEditorRowProps) {
  return (
    <form className="records-row records-row-editor" onSubmit={props.onSubmit}>
      <div className="records-cell records-cell-type">
        <label className="sr-only" htmlFor={`record-type-${props.editor.sourceKey}`}>
          Type
        </label>
        <select
          disabled={!props.canWrite || props.isSaving}
          id={`record-type-${props.editor.sourceKey}`}
          onChange={(event) =>
            props.onChange({
              ...props.editor,
              recordType: event.target.value as RecordType,
            })
          }
          value={props.editor.recordType}
        >
          {recordTypeOptions.map((recordType) => (
            <option key={recordType} value={recordType}>
              {recordType}
            </option>
          ))}
        </select>
      </div>
      <div className="records-cell records-cell-name">
        <label className="sr-only" htmlFor={`record-name-${props.editor.sourceKey}`}>
          Name
        </label>
        <input
          autoFocus
          disabled={!props.canWrite || props.isSaving}
          id={`record-name-${props.editor.sourceKey}`}
          onChange={(event) =>
            props.onChange({ ...props.editor, name: event.target.value })
          }
          placeholder="@"
          value={props.editor.name}
        />
      </div>
      <div className="records-cell records-cell-ttl">
        <label className="sr-only" htmlFor={`record-ttl-${props.editor.sourceKey}`}>
          TTL
        </label>
        <input
          disabled={!props.canWrite || props.isSaving}
          id={`record-ttl-${props.editor.sourceKey}`}
          inputMode="numeric"
          onChange={(event) =>
            props.onChange({ ...props.editor, ttl: event.target.value })
          }
          value={props.editor.ttl}
        />
      </div>
      <div className="records-cell records-cell-value">
        <label
          className="sr-only"
          htmlFor={`record-values-${props.editor.sourceKey}`}
        >
          Value
        </label>
        <textarea
          disabled={!props.canWrite || props.isSaving}
          id={`record-values-${props.editor.sourceKey}`}
          onChange={(event) =>
            props.onChange({ ...props.editor, valuesText: event.target.value })
          }
          placeholder="One value per line"
          rows={Math.min(
            3,
            Math.max(1, props.editor.valuesText.split(/\r?\n/).length),
          )}
          value={props.editor.valuesText}
        />
      </div>
      <div className="records-cell records-cell-actions records-cell-actions-editor">
        <button
          className="primary-button"
          disabled={!props.canWrite || props.isSaving}
          type="submit"
        >
          {props.isSaving ? "Saving..." : "Save"}
        </button>
        <button
          className="secondary-button"
          disabled={props.isSaving}
          onClick={props.onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
      {props.feedback ? (
        <div className={`records-inline-feedback records-inline-feedback-${props.feedback.kind}`}>
          {props.feedback.message}
        </div>
      ) : null}
    </form>
  );
}

type RecordDisplayRowProps = {
  canWrite: boolean;
  feedback: RowFeedback | null;
  isDeleting: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onToggleSelection: () => void;
  record: RecordSet;
  selected: boolean;
};

function RecordDisplayRow(props: RecordDisplayRowProps) {
  return (
    <div className="records-row">
      <div className="records-cell records-cell-type">
        <span className="record-type-pill">{props.record.recordType}</span>
      </div>
      <div className="records-cell records-cell-name">
        <div className="record-name-stack">
          <label className="checkbox-line record-select-line">
            <input
              aria-label={`Select ${props.record.name} ${props.record.recordType}`}
              checked={props.selected}
              disabled={!props.canWrite}
              onChange={props.onToggleSelection}
              type="checkbox"
            />
            <strong>{props.record.name}</strong>
          </label>
          <span>{formatValueCount(props.record.values.length)}</span>
        </div>
      </div>
      <div className="records-cell records-cell-ttl">
        <span className="record-ttl-value">{props.record.ttl}</span>
      </div>
      <div className="records-cell records-cell-value">
        <code>{props.record.values.join("\n")}</code>
      </div>
      <div className="records-cell records-cell-actions">
        <div className="row-actions">
          <button
            className="secondary-button"
            disabled={!props.canWrite}
            onClick={props.onEdit}
            type="button"
          >
            Edit
          </button>
          <button
            className="secondary-button"
            disabled={!props.canWrite}
            onClick={props.onDuplicate}
            type="button"
          >
            Duplicate
          </button>
          <button
            className="secondary-button secondary-button-danger"
            disabled={!props.canWrite || props.isDeleting}
            onClick={props.onDelete}
            type="button"
          >
            {props.isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
      {props.feedback ? (
        <div className={`records-inline-feedback records-inline-feedback-${props.feedback.kind}`}>
          {props.feedback.message}
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("records");
  const [selectedZoneName, setSelectedZoneName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | RecordType>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [recordEditor, setRecordEditor] = useState<RecordEditorState | null>(null);
  const [rowFeedback, setRowFeedback] = useState<RowFeedback | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [selectedGrantUsername, setSelectedGrantUsername] = useState<string | null>(
    null,
  );
  const [selectedUserRole, setSelectedUserRole] = useState<
    "admin" | "editor" | "viewer"
  >("viewer");
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
  const [providerClaimsRules, setProviderClaimsRules] = useState(
    '{\n  "usernameClaim": "preferred_username",\n  "rolesClaim": "groups",\n  "adminGroups": ["dns-admins"],\n  "zoneEditorPattern": "zone-{zone}-editors",\n  "zoneViewerPattern": "zone-{zone}-viewers"\n}',
  );
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [grantActions, setGrantActions] = useState<string[]>(["read"]);
  const [selectedRecordKeys, setSelectedRecordKeys] = useState<string[]>([]);
  const [discoveryBackendName, setDiscoveryBackendName] = useState("");
  const [discoveredZoneNames, setDiscoveredZoneNames] = useState<string[]>([]);
  const [lastDiscoveredBackendName, setLastDiscoveredBackendName] = useState<
    string | null
  >(null);
  const [serviceAccountUsername, setServiceAccountUsername] = useState("");
  const [serviceAccountRole, setServiceAccountRole] = useState<
    "admin" | "editor" | "viewer"
  >("editor");
  const [tokenTargetUsername, setTokenTargetUsername] = useState("");
  const [tokenName, setTokenName] = useState("automation");
  const [issuedToken, setIssuedToken] = useState<ApiTokenCreateResponse | null>(
    null,
  );

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false,
  });
  const authSettingsQuery = useQuery({
    queryKey: ["auth-settings"],
    queryFn: fetchAuthSettings,
    retry: false,
  });
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: fetchSession,
    retry: false,
  });

  const session = sessionQuery.data;
  const isAuthenticated = session?.authenticated === true && session.user !== null;
  const currentUser = isAuthenticated ? session.user : null;
  const isAdmin = currentUser?.role === "admin";
  const oidcProvidersQuery = useQuery({
    queryKey: ["oidc-providers"],
    queryFn: fetchOidcProviders,
    enabled: !isAuthenticated && authSettingsQuery.data?.oidcEnabled === true,
    retry: false,
  });

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
  const adminServiceAccountsQuery = useQuery({
    queryKey: ["admin-service-accounts"],
    queryFn: fetchAdminServiceAccounts,
    enabled: isAdmin,
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
        queryClient.invalidateQueries({ queryKey: ["admin-service-accounts"] }),
        queryClient.invalidateQueries({
          queryKey: ["admin-identity-providers"],
        }),
      ]);
      setWorkspaceTab("records");
    },
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async (nextSession) => {
      queryClient.setQueryData(["session"], nextSession);
      for (const key of [
        "backends",
        "zones",
        "zone-records",
        "admin-users",
        "admin-backends",
        "admin-service-accounts",
        "admin-identity-providers",
        "admin-zone-grants",
      ]) {
        queryClient.removeQueries({ queryKey: [key] });
      }
      setSelectedZoneName(null);
      setSelectedGrantUsername(null);
      setRecordEditor(null);
      setRowFeedback(null);
      setWorkspaceNotice(null);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const oidcLoginMutation = useMutation({
    mutationFn: startOidcLogin,
    onSuccess: ({ authorizationUrl }) => {
      window.location.assign(authorizationUrl);
    },
  });
  const syncBackendMutation = useMutation({
    mutationFn: syncAdminBackendZones,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
      ]);
    },
  });
  const createRecordMutation = useMutation({
    mutationFn: createZoneRecord,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-records", selectedZoneName] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
    },
  });
  const updateRecordMutation = useMutation({
    mutationFn: updateZoneRecord,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-records", selectedZoneName] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
    },
  });
  const deleteRecordMutation = useMutation({
    mutationFn: deleteZoneRecord,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-records", selectedZoneName] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
    },
  });
  const bulkChangeMutation = useMutation({
    mutationFn: applyBulkZoneChanges,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-records", selectedZoneName] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
    },
  });
  const createBackendMutation = useMutation({
    mutationFn: createAdminBackend,
    onSuccess: async (backend) => {
      resetBackendForm();
      setWorkspaceNotice(`Backend config saved for ${backend.name}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
      ]);
    },
  });
  const deleteBackendMutation = useMutation({
    mutationFn: deleteAdminBackend,
    onSuccess: async (_response, backendNameToDelete) => {
      setWorkspaceNotice(`Backend config deleted for ${backendNameToDelete}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
      ]);
    },
  });
  const createIdentityProviderMutation = useMutation({
    mutationFn: createAdminIdentityProvider,
    onSuccess: async (provider) => {
      resetProviderForm();
      setWorkspaceNotice(`OIDC config saved for ${provider.name}.`);
      await queryClient.invalidateQueries({
        queryKey: ["admin-identity-providers"],
      });
    },
  });
  const deleteIdentityProviderMutation = useMutation({
    mutationFn: deleteAdminIdentityProvider,
    onSuccess: async (_response, providerNameToDelete) => {
      setWorkspaceNotice(`OIDC config deleted for ${providerNameToDelete}.`);
      await queryClient.invalidateQueries({
        queryKey: ["admin-identity-providers"],
      });
    },
  });
  const updateUserRoleMutation = useMutation({
    mutationFn: updateAdminUserRole,
    onSuccess: async (updatedUser) => {
      setWorkspaceNotice(`Global role updated for ${updatedUser.username}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-zone-grants"] }),
      ]);
    },
  });
  const assignGrantMutation = useMutation({
    mutationFn: assignAdminZoneGrant,
    onSuccess: async (grant) => {
      setWorkspaceNotice(`Zone grant saved for ${grant.username} on ${grant.zoneName}.`);
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: ["admin-zone-grants"] }),
      ];

      if (grant.username === currentUser?.username) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: ["zones"] }));
      }

      await Promise.all(invalidations);
    },
  });
  const discoverZonesMutation = useMutation({
    mutationFn: discoverAdminBackendZones,
  });
  const importZonesMutation = useMutation({
    mutationFn: importAdminBackendZones,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
      ]);
    },
  });
  const createServiceAccountMutation = useMutation({
    mutationFn: createAdminServiceAccount,
    onSuccess: async (serviceAccount) => {
      setServiceAccountUsername("");
      setServiceAccountRole("editor");
      setWorkspaceNotice(`Service account created for ${serviceAccount.username}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-service-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
      ]);
    },
  });
  const createServiceAccountTokenMutation = useMutation({
    mutationFn: createAdminServiceAccountToken,
    onSuccess: (token) => {
      setIssuedToken(token);
      setWorkspaceNotice(`Token issued for ${token.username}.`);
    },
  });

  const zoneItems = zonesQuery.data?.items ?? emptyZones;
  const backendItems = backendsQuery.data?.items ?? emptyBackends;
  const selectedZone =
    zoneItems.find((zone) => zone.name === selectedZoneName) ?? null;
  const selectedBackend =
    backendItems.find((backend) => backend.name === selectedZone?.backendName) ?? null;
  const records = zoneRecordsQuery.data?.items ?? emptyRecords;
  const adminUsers = adminUsersQuery.data?.items ?? emptyAdminUsers;
  const selectedAdminUser =
    adminUsers.find((user) => user.username === selectedGrantUsername) ?? null;
  const preferredGrantUser =
    adminUsers.find((user) => user.role !== "admin") ?? adminUsers[0] ?? null;
  const isWorkspaceInitializing =
    isAuthenticated &&
    ((zonesQuery.isLoading && zoneItems.length === 0) ||
      (zoneItems.length > 0 && selectedZoneName === null));
  const canWriteRecords =
    currentUser !== null &&
    currentUser.role !== "viewer" &&
    selectedBackend?.capabilities.includes("writeRecords") === true;
  const filteredRecords = records.filter((record) => {
    if (typeFilter !== "ALL" && record.recordType !== typeFilter) {
      return false;
    }

    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return true;
    }

    return `${record.recordType} ${record.name} ${record.ttl} ${record.values.join(" ")}`
      .toLowerCase()
      .includes(query);
  });
  const sortedRecords = sortRecords(filteredRecords, sortKey, sortDirection);
  const selectedRowFeedback =
    rowFeedback && recordEditor && rowFeedback.key === recordEditor.sourceKey
      ? rowFeedback
      : null;
  const oidcProviders = oidcProvidersQuery.data?.items ?? emptyOidcProviders;
  const hasActiveRecordFilters =
    searchQuery.trim().length > 0 || typeFilter !== "ALL";
  const recordsAccessLabel = getRecordsAccessLabel({
    canWriteRecords,
    hasSelectedBackend: selectedBackend !== null,
    role: currentUser?.role,
  });
  const selectedZoneDisplay = isWorkspaceInitializing
    ? "Loading..."
    : selectedZone?.name ?? "—";
  const selectedBackendNameDisplay = isWorkspaceInitializing
    ? "Loading..."
    : selectedZone?.backendName ?? "—";
  const selectedBackendTypeDisplay = isWorkspaceInitializing
    ? "Loading..."
    : selectedBackend?.backendType ?? "—";
  const recordsAccessDisplay = isWorkspaceInitializing ? "loading" : recordsAccessLabel;
  const visibleAdminBackends = isAdmin
    ? adminBackendsQuery.data?.items ?? []
    : backendItems;
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
  const isGrantChangeBlocked = selectedAdminUser?.role === "admin";
  const selectedRecords = records.filter((record) =>
    selectedRecordKeys.includes(getRecordKey(record)),
  );
  const serviceAccounts = adminServiceAccountsQuery.data?.items ?? [];
  const lastDiscoveredZones = discoverZonesMutation.data?.items ?? [];
  const selectedDiscoveredZones = lastDiscoveredZones.filter((zone) =>
    discoveredZoneNames.includes(zone.name),
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setSelectedZoneName(null);
      return;
    }
    if (zoneItems.length === 0) {
      setSelectedZoneName(null);
      return;
    }
    if (
      !selectedZoneName ||
      !zoneItems.some((zone) => zone.name === selectedZoneName)
    ) {
      setSelectedZoneName(zoneItems[0].name);
    }
  }, [isAuthenticated, selectedZoneName, zoneItems]);

  useEffect(() => {
    if (!isAdmin) {
      setSelectedGrantUsername(null);
      return;
    }
    if (adminUsers.length === 0) {
      setSelectedGrantUsername(null);
      return;
    }
    if (
      !selectedGrantUsername ||
      !adminUsers.some((user) => user.username === selectedGrantUsername)
    ) {
      setSelectedGrantUsername(preferredGrantUser?.username ?? adminUsers[0].username);
    }
  }, [adminUsers, isAdmin, preferredGrantUser, selectedGrantUsername]);

  useEffect(() => {
    if (!selectedAdminUser) {
      setSelectedUserRole("viewer");
      return;
    }
    setSelectedUserRole(selectedAdminUser.role);
  }, [selectedAdminUser]);

  useEffect(() => {
    setRecordEditor(null);
    setRowFeedback(null);
    setSelectedRecordKeys([]);
  }, [selectedZoneName]);

  useEffect(() => {
    assignGrantMutation.reset();
    updateUserRoleMutation.reset();
    // Mutation objects are not stable across renders; only reset when the grant context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGrantUsername, selectedZoneName]);

  useEffect(() => {
    if (!isAdmin) {
      setDiscoveryBackendName("");
      setLastDiscoveredBackendName(null);
      setDiscoveredZoneNames([]);
      return;
    }

    const backendNames = visibleAdminBackends.map((backend) => backend.name);
    if (selectedBackend && backendNames.includes(selectedBackend.name)) {
      setDiscoveryBackendName((current) =>
        current.length > 0 ? current : selectedBackend.name,
      );
      return;
    }

    if (
      discoveryBackendName.length === 0 ||
      !backendNames.includes(discoveryBackendName)
    ) {
      setDiscoveryBackendName(backendNames[0] ?? "");
    }
  }, [discoveryBackendName, isAdmin, selectedBackend, visibleAdminBackends]);

  useEffect(() => {
    if (!isAdmin) {
      setTokenTargetUsername("");
      setIssuedToken(null);
      return;
    }

    const usernames = serviceAccounts.map((account) => account.username);
    if (tokenTargetUsername.length === 0 || !usernames.includes(tokenTargetUsername)) {
      setTokenTargetUsername(usernames[0] ?? "");
    }
  }, [isAdmin, serviceAccounts, tokenTargetUsername]);

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

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate({ username, password });
  }

  function handleOidcLogin(providerName: string) {
    oidcLoginMutation.mutate({
      providerName,
      returnTo: window.location.origin,
    });
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
      claimsMappingRules = JSON.parse(providerClaimsRules) as Record<
        string,
        unknown
      >;
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
        providerClientSecret.trim().length > 0
          ? providerClientSecret
          : undefined,
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

  function toggleRecordSelection(recordKey: string) {
    setSelectedRecordKeys((current) =>
      current.includes(recordKey)
        ? current.filter((item) => item !== recordKey)
        : [...current, recordKey],
    );
  }

  function openCreateRecord(prefill?: RecordSet) {
    startTransition(() => {
      setWorkspaceTab("records");
      setRecordEditor(prefill ? createEditorFromRecord(prefill, "create") : createEmptyEditor());
      setRowFeedback(null);
    });
  }

  function openUpdateRecord(record: RecordSet) {
    if (!canWriteRecords) {
      return;
    }
    setRecordEditor(createEditorFromRecord(record, "update"));
    setRowFeedback(null);
  }

  async function handleRecordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recordEditor || !selectedZoneName) return;

    const ttl = Number.parseInt(recordEditor.ttl, 10);
    const values = parseRecordValues(recordEditor.valuesText);

    if (!Number.isFinite(ttl) || ttl <= 0) {
      setRowFeedback({
        key: recordEditor.sourceKey,
        kind: "error",
        message: "TTL must be a positive integer.",
      });
      return;
    }

    if (values.length === 0) {
      setRowFeedback({
        key: recordEditor.sourceKey,
        kind: "error",
        message: "Add at least one record value.",
      });
      return;
    }

    try {
      if (recordEditor.mode === "create") {
        await createRecordMutation.mutateAsync({
          zoneName: selectedZoneName,
          name: recordEditor.name.trim(),
          recordType: recordEditor.recordType,
          ttl,
          values,
        });
        setWorkspaceNotice("Record created.");
      } else if (recordEditor.version) {
        await updateRecordMutation.mutateAsync({
          zoneName: selectedZoneName,
          name: recordEditor.name.trim(),
          recordType: recordEditor.recordType,
          ttl,
          values,
          expectedVersion: recordEditor.version,
        });
        setWorkspaceNotice("Record updated.");
      }

      setRecordEditor(null);
      setRowFeedback(null);
    } catch (error) {
      setRowFeedback({
        key: recordEditor.sourceKey,
        kind: "error",
        message: getFeedbackText(error, "Record change failed."),
      });
    }
  }

  async function handleDeleteRecord(record: RecordSet) {
    if (!selectedZoneName) return;
    if (
      !window.confirm(`Delete ${record.name} ${record.recordType} from ${selectedZoneName}?`)
    ) {
      return;
    }

    try {
      await deleteRecordMutation.mutateAsync({
        zoneName: selectedZoneName,
        name: record.name,
        recordType: record.recordType,
        expectedVersion: record.version,
      });
      setWorkspaceNotice(`Deleted ${record.name} ${record.recordType}.`);
      setRowFeedback(null);
      if (recordEditor?.sourceKey === getRecordKey(record)) {
        setRecordEditor(null);
      }
    } catch (error) {
      setRowFeedback({
        key: getRecordKey(record),
        kind: "error",
        message: getFeedbackText(error, "Delete failed."),
      });
    }
  }

  async function handleSyncSelectedBackend() {
    if (!selectedBackend || !isAdmin) return;

    try {
      await syncBackendMutation.mutateAsync(selectedBackend.name);
      setWorkspaceNotice(`Backend sync completed for ${selectedBackend.name}.`);
    } catch (error) {
      setWorkspaceNotice(getFeedbackText(error, "Backend sync failed."));
    }
  }

  async function handleBulkDeleteSelected() {
    if (!selectedZoneName || selectedRecords.length === 0) return;
    if (
      !window.confirm(
        `Delete ${selectedRecords.length} selected RRset(s) from ${selectedZoneName}?`,
      )
    ) {
      return;
    }

    try {
      const result = await bulkChangeMutation.mutateAsync({
        zoneName: selectedZoneName,
        items: selectedRecords.map((record) => ({
          operation: "delete",
          name: record.name,
          recordType: record.recordType,
          expectedVersion: record.version,
        })),
      });
      setSelectedRecordKeys([]);
      setWorkspaceNotice(
        result.hasConflicts
          ? "Bulk delete completed with conflicts."
          : `Deleted ${result.items.length} RRset(s).`,
      );
    } catch (error) {
      setWorkspaceNotice(getFeedbackText(error, "Bulk delete failed."));
    }
  }

  async function handleDiscoverZones() {
    if (!discoveryBackendName) return;

    try {
      const discovered = await discoverZonesMutation.mutateAsync(discoveryBackendName);
      setLastDiscoveredBackendName(discovered.backendName);
      setDiscoveredZoneNames(
        discovered.items.filter((zone) => !zone.managed).map((zone) => zone.name),
      );
      setWorkspaceNotice(`Discovered ${discovered.items.length} zone(s).`);
    } catch (error) {
      setWorkspaceNotice(getFeedbackText(error, "Backend discovery failed."));
    }
  }

  async function handleImportDiscoveredZones() {
    if (!discoveryBackendName || selectedDiscoveredZones.length === 0) return;

    try {
      const imported = await importZonesMutation.mutateAsync({
        backendName: discoveryBackendName,
        zoneNames: selectedDiscoveredZones.map((zone) => zone.name),
      });
      setDiscoveredZoneNames([]);
      setWorkspaceNotice(
        `Imported ${imported.importedZones.length} zone(s) from ${imported.backendName}.`,
      );
      if (lastDiscoveredBackendName === discoveryBackendName) {
        await handleDiscoverZones();
      }
    } catch (error) {
      setWorkspaceNotice(getFeedbackText(error, "Backend import failed."));
    }
  }

  function handleServiceAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createServiceAccountMutation.mutate({
      username: serviceAccountUsername,
      role: serviceAccountRole,
    });
  }

  function handleTokenIssueSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tokenTargetUsername) return;
    createServiceAccountTokenMutation.mutate({
      username: tokenTargetUsername,
      name: tokenName,
    });
  }

  function handleSortChange(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  const sharedAdminConsoleProps = {
    showHeader: false,
    showTabs: false,
    onSectionChange: (section: AdminSection) => {
      startTransition(() => {
        if (section === "backends") setWorkspaceTab("operations");
        if (section === "access") setWorkspaceTab("access");
        if (section === "identity") setWorkspaceTab("auth");
      });
    },
    editingBackendName,
    isBackendFormDirty,
    backendName,
    backendType,
    backendCapabilities,
    setBackendName,
    setBackendType,
    setBackendCapabilities,
    onResetBackendForm: resetBackendForm,
    onBackendSubmit: handleBackendSubmit,
    createBackendPending: createBackendMutation.isPending,
    createBackendError: createBackendMutation.isError,
    createBackendSuccess: createBackendMutation.isSuccess,
    adminBackends: visibleAdminBackends,
    adminBackendsLoading: isAdmin ? adminBackendsQuery.isLoading : backendsQuery.isLoading,
    onEditBackend: (backend: Backend) => {
      setEditingBackendName(backend.name);
      setBackendName(backend.name);
      setBackendType(backend.backendType);
      setBackendCapabilities(backend.capabilities.join(", "));
      setWorkspaceTab("operations");
    },
    onSyncBackend: (backendNameToSync: string) =>
      syncBackendMutation.mutate(backendNameToSync),
    onDeleteBackend: (backendNameToDelete: string) => {
      if (window.confirm(`Delete backend config '${backendNameToDelete}'?`)) {
        deleteBackendMutation.mutate(backendNameToDelete);
      }
    },
    syncBackendPending: syncBackendMutation.isPending,
    deleteBackendPending: deleteBackendMutation.isPending,
    editingProviderName,
    isProviderFormDirty,
    providerName,
    providerIssuer,
    providerClientId,
    providerClientSecret,
    providerScopes,
    providerClaimsRules,
    setProviderName,
    setProviderIssuer,
    setProviderClientId,
    setProviderClientSecret,
    setProviderScopes,
    setProviderClaimsRules,
    onResetProviderForm: resetProviderForm,
    onIdentityProviderSubmit: handleIdentityProviderSubmit,
    createIdentityProviderPending: createIdentityProviderMutation.isPending,
    createIdentityProviderError: createIdentityProviderMutation.isError,
    createIdentityProviderSuccess: createIdentityProviderMutation.isSuccess,
    providerFormError,
    adminIdentityProviders: adminIdentityProvidersQuery.data?.items ?? [],
    adminIdentityProvidersLoading: adminIdentityProvidersQuery.isLoading,
    onEditIdentityProvider: (provider: {
      name: string;
      issuer: string;
      clientId: string;
      scopes: string[];
      claimsMappingRules: Record<string, unknown>;
    }) => {
      setEditingProviderName(provider.name);
      setProviderName(provider.name);
      setProviderIssuer(provider.issuer);
      setProviderClientId(provider.clientId);
      setProviderClientSecret("");
      setProviderScopes(provider.scopes.join(", "));
      setProviderClaimsRules(JSON.stringify(provider.claimsMappingRules, null, 2));
      setProviderFormError(null);
      setWorkspaceTab("auth");
    },
    onDeleteIdentityProvider: (providerNameToDelete: string) => {
      if (window.confirm(`Delete IdP config '${providerNameToDelete}'?`)) {
        deleteIdentityProviderMutation.mutate(providerNameToDelete);
      }
    },
    deleteIdentityProviderPending: deleteIdentityProviderMutation.isPending,
    isEditingCurrentUser,
    adminUsers,
    selectedGrantUsername,
    selectedUserRole,
    selectedAdminUserRole: selectedAdminUser?.role,
    setSelectedGrantUsername,
    setSelectedUserRole,
    onRoleSubmit: handleRoleSubmit,
    updateUserRolePending: updateUserRoleMutation.isPending,
    updateUserRoleError: updateUserRoleMutation.isError,
    updateUserRoleSuccess: updateUserRoleMutation.isSuccess,
    isRoleChangeBlocked,
    isGrantChangeBlocked,
    zoneContextName: selectedZoneName,
    grantActions,
    toggleGrantAction: (action: string) =>
      setGrantActions((current) => toggleAction(current, action)),
    onGrantSubmit: handleGrantSubmit,
    assignGrantPending: assignGrantMutation.isPending,
    assignGrantError: assignGrantMutation.isError,
    assignGrantSuccess: assignGrantMutation.isSuccess,
    adminZoneGrants: adminZoneGrantsQuery.data?.items ?? [],
    adminZoneGrantsLoading: adminZoneGrantsQuery.isLoading,
  };

  function renderOperationsTab() {
    return (
      <section className="admin-surface">
        <div className="section-header">
          <div>
            <p className="section-label">Operations</p>
            <h1>Backend inventory</h1>
          </div>
          <p className="section-copy">
            Backend-level sync is supported today. Per-zone sync stays a future stub
            until the API exposes it.
          </p>
        </div>
        {isAdmin ? (
          <div className="stack-layout">
            <AdminConsole
              {...sharedAdminConsoleProps}
              activeSection="backends"
              activeSectionDescription={adminSectionMeta.backends.description}
              activeSectionLabel={adminSectionMeta.backends.label}
            />
            <section className="panel stack-card">
              <div className="panel-heading">
                <div>
                  <p className="panel-label">Discovery</p>
                  <h2>Discover and import zones</h2>
                </div>
                <span className="panel-meta">
                  {lastDiscoveredZones.length} discovered
                </span>
              </div>
              <form
                className="stacked-form stacked-form-split"
                onSubmit={(event) => event.preventDefault()}
              >
                <label>
                  <span>Backend</span>
                  <select
                    aria-label="Discovery backend"
                    onChange={(event) => setDiscoveryBackendName(event.target.value)}
                    value={discoveryBackendName}
                  >
                    {visibleAdminBackends.map((backend) => (
                      <option key={backend.name} value={backend.name}>
                        {backend.name} · {backend.backendType}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="inline-actions">
                  <button
                    className="primary-button"
                    disabled={
                      discoveryBackendName.length === 0 ||
                      discoverZonesMutation.isPending
                    }
                    onClick={() => void handleDiscoverZones()}
                    type="button"
                  >
                    {discoverZonesMutation.isPending ? "Discovering..." : "Discover zones"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={
                      selectedDiscoveredZones.length === 0 ||
                      importZonesMutation.isPending
                    }
                    onClick={() => void handleImportDiscoveredZones()}
                    type="button"
                  >
                    {importZonesMutation.isPending
                      ? "Importing..."
                      : `Import selected (${selectedDiscoveredZones.length})`}
                  </button>
                </div>
                {discoverZonesMutation.isError ? (
                  <p className="status-error">Zone discovery could not be completed.</p>
                ) : null}
                {importZonesMutation.isError ? (
                  <p className="status-error">Zone import could not be completed.</p>
                ) : null}
              </form>
              {lastDiscoveredBackendName === discoveryBackendName &&
              lastDiscoveredZones.length > 0 ? (
                <ul className="resource-list">
                  {lastDiscoveredZones.map((zone) => (
                    <li key={zone.name} className="resource-item-action">
                      <label className="resource-copy checkbox-line">
                        <input
                          checked={discoveredZoneNames.includes(zone.name)}
                          disabled={zone.managed}
                          onChange={() =>
                            setDiscoveredZoneNames((current) =>
                              current.includes(zone.name)
                                ? current.filter((item) => item !== zone.name)
                                : [...current, zone.name],
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          <strong>{zone.name}</strong>
                          <span>{zone.managed ? "already managed" : "ready to import"}</span>
                        </span>
                      </label>
                      <span className="backend-config-type">{zone.backendName}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder-copy">
                  Run discovery against a backend to review importable zones.
                </p>
              )}
            </section>
          </div>
        ) : (
          <div className="read-only-list">
            <div className="read-only-list-header">
              <span>Name</span>
              <span>Type</span>
              <span>Capabilities</span>
            </div>
            {visibleAdminBackends.map((backend) => (
              <div key={backend.name} className="read-only-list-row">
                <strong>{backend.name}</strong>
                <span>{backend.backendType}</span>
                <span>{backend.capabilities.join(", ")}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderAccessTab() {
    return (
      <section className="admin-surface">
        <div className="section-header">
          <div>
            <p className="section-label">Access</p>
            <h1>Roles and zone grants</h1>
          </div>
          <p className="section-copy">
            Access stays anchored to the currently selected zone so operators do not
            lose context while granting.
          </p>
        </div>
        {isAdmin ? (
          <AdminConsole
            {...sharedAdminConsoleProps}
            activeSection="access"
            activeSectionDescription={adminSectionMeta.access.description}
            activeSectionLabel={adminSectionMeta.access.label}
          />
        ) : (
          <div className="empty-state">
            <strong>Admin only</strong>
            <p>Role and grant management is only exposed to admin sessions.</p>
          </div>
        )}
      </section>
    );
  }

  function renderAuthTab() {
    return (
      <section className="admin-surface">
        <div className="section-header">
          <div>
            <p className="section-label">Auth</p>
            <h1>Auth hardening</h1>
          </div>
          <p className="section-copy">
            Day 20 scope lives here: session settings, CSRF posture, self-signup
            lockout, and identity provider wiring.
          </p>
        </div>
        <div className="auth-summary-grid">
          <div className="summary-line">
            <span>Local login</span>
            <strong>
              {authSettingsQuery.data?.localLoginEnabled ? "enabled" : "disabled"}
            </strong>
          </div>
          <div className="summary-line">
            <span>OIDC</span>
            <strong>{authSettingsQuery.data?.oidcEnabled ? "enabled" : "disabled"}</strong>
          </div>
          <div className="summary-line">
            <span>CSRF</span>
            <strong>{authSettingsQuery.data?.csrfEnabled ? "enabled" : "disabled"}</strong>
          </div>
          <div className="summary-line">
            <span>Self-signup</span>
            <strong>
              {authSettingsQuery.data?.oidcSelfSignupEnabled ? "enabled" : "disabled"}
            </strong>
          </div>
          <div className="summary-line">
            <span>Session TTL</span>
            <strong>
              {authSettingsQuery.data
                ? `${Math.round(authSettingsQuery.data.sessionTtlSeconds / 3600)}h`
                : "—"}
            </strong>
          </div>
          <div className="summary-line">
            <span>Bootstrap admin</span>
            <strong>
              {authSettingsQuery.data?.bootstrapAdminEnabled ? "enabled" : "disabled"}
            </strong>
          </div>
        </div>
        {isAdmin ? (
          <div className="stack-layout">
            <AdminConsole
              {...sharedAdminConsoleProps}
              activeSection="identity"
              activeSectionDescription={adminSectionMeta.identity.description}
              activeSectionLabel={adminSectionMeta.identity.label}
            />
            <section className="panel stack-card">
              <div className="panel-heading">
                <div>
                  <p className="panel-label">Automation</p>
                  <h2>Service accounts and tokens</h2>
                </div>
                <span className="panel-meta">{serviceAccounts.length} accounts</span>
              </div>
              <div className="stack-layout stack-layout-compact">
                <form className="stacked-form stacked-form-split" onSubmit={handleServiceAccountSubmit}>
                  <label>
                    <span>Service account username</span>
                    <input
                      aria-label="Service account username"
                      onChange={(event) => setServiceAccountUsername(event.target.value)}
                      value={serviceAccountUsername}
                    />
                  </label>
                  <label>
                    <span>Role</span>
                    <select
                      aria-label="Service account role"
                      onChange={(event) =>
                        setServiceAccountRole(
                          event.target.value as "admin" | "editor" | "viewer",
                        )
                      }
                      value={serviceAccountRole}
                    >
                      <option value="admin">admin</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    disabled={
                      serviceAccountUsername.trim().length === 0 ||
                      createServiceAccountMutation.isPending
                    }
                    type="submit"
                  >
                    {createServiceAccountMutation.isPending
                      ? "Creating..."
                      : "Create service account"}
                  </button>
                  {createServiceAccountMutation.isError ? (
                    <p className="status-error">
                      Service account could not be created.
                    </p>
                  ) : null}
                </form>
                <form className="stacked-form stacked-form-split" onSubmit={handleTokenIssueSubmit}>
                  <label>
                    <span>Target service account</span>
                    <select
                      aria-label="Token target service account"
                      onChange={(event) => {
                        setTokenTargetUsername(event.target.value);
                        setIssuedToken(null);
                      }}
                      value={tokenTargetUsername}
                    >
                      {serviceAccounts.map((account) => (
                        <option key={account.username} value={account.username}>
                          {account.username} · {account.role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Token name</span>
                    <input
                      aria-label="Service account token name"
                      onChange={(event) => setTokenName(event.target.value)}
                      value={tokenName}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={
                      tokenTargetUsername.length === 0 ||
                      tokenName.trim().length === 0 ||
                      createServiceAccountTokenMutation.isPending
                    }
                    type="submit"
                  >
                    {createServiceAccountTokenMutation.isPending
                      ? "Issuing..."
                      : "Issue API token"}
                  </button>
                  {createServiceAccountTokenMutation.isError ? (
                    <p className="status-error">API token could not be issued.</p>
                  ) : null}
                </form>
                {issuedToken ? (
                  <div className="status-callout">
                    <strong>Issued token</strong>
                    <p>{issuedToken.username}</p>
                    <code className="token-preview">{issuedToken.token}</code>
                  </div>
                ) : null}
                <ul className="resource-list">
                  {serviceAccounts.map((account) => (
                    <li key={account.username} className="resource-item-action">
                      <div className="resource-copy">
                        <strong>{account.username}</strong>
                        <span>
                          {account.role} · {account.authSource} ·{" "}
                          {account.isActive ? "active" : "inactive"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                {!adminServiceAccountsQuery.isLoading && serviceAccounts.length === 0 ? (
                  <p className="placeholder-copy">
                    No service accounts have been created yet.
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        ) : (
          <div className="empty-state">
            <strong>Read-only auth posture</strong>
            <p>Identity provider management is reserved for admin sessions.</p>
          </div>
        )}
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-copy">
            <p className="section-label">Day 20</p>
            <h1>Zonix control plane</h1>
            <p>
              Login, inspect zone state, and operate DNS records without hunting
              through a dashboard maze.
            </p>
          </div>
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
            {loginMutation.isError ? (
              <p className="status-error">Invalid username or password.</p>
            ) : null}
            {authSettingsQuery.data?.oidcEnabled ? (
              <div className="login-oidc">
                <div className="login-oidc-header">
                  <span>OIDC</span>
                  <strong>
                    {oidcProvidersQuery.isLoading ? "discovering…" : `${oidcProviders.length} provider(s)`}
                  </strong>
                </div>
                {oidcProviders.map((provider) => (
                  <button
                    key={provider.name}
                    className="secondary-button"
                    disabled={oidcLoginMutation.isPending}
                    onClick={() => handleOidcLogin(provider.name)}
                    type="button"
                  >
                    {oidcLoginMutation.isPending
                      ? "Redirecting…"
                      : `Sign in with ${provider.name}`}
                  </button>
                ))}
                {oidcProvidersQuery.isError ? (
                  <p className="status-error">OIDC providers could not be loaded.</p>
                ) : null}
                {oidcLoginMutation.isError ? (
                  <p className="status-error">OIDC sign-in could not be started.</p>
                ) : null}
              </div>
            ) : null}
          </form>
        </section>
        <aside className="login-aside">
          <div className="summary-line">
            <span>API status</span>
            <strong>{healthQuery.data?.status ?? "checking"}</strong>
          </div>
          <div className="summary-line">
            <span>Inventory sync</span>
            <strong>{healthQuery.data?.inventorySync ?? "pending"}</strong>
          </div>
          <div className="summary-line">
            <span>CSRF</span>
            <strong>{authSettingsQuery.data?.csrfEnabled ? "enabled" : "disabled"}</strong>
          </div>
          <div className="summary-line">
            <span>Self-signup</span>
            <strong>
              {authSettingsQuery.data?.oidcSelfSignupEnabled ? "enabled" : "disabled"}
            </strong>
          </div>
          <div className="summary-line">
            <span>Session TTL</span>
            <strong>
              {authSettingsQuery.data
                ? `${Math.round(authSettingsQuery.data.sessionTtlSeconds / 3600)}h`
                : "—"}
            </strong>
          </div>
          {healthQuery.isError ? (
            <p className="status-error">
              Backend unavailable. Start the API before using the UI.
            </p>
          ) : null}
        </aside>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-context">
          <label className="topbar-field">
            <span>Zone</span>
            <select
              aria-label="Zone"
              onChange={(event) =>
                startTransition(() => setSelectedZoneName(event.target.value))
              }
              value={selectedZoneName ?? ""}
            >
              {zoneItems.map((zone) => (
                <option key={zone.name} value={zone.name}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>
          <div className="topbar-field">
            <span>Backend</span>
            <strong>{selectedBackendNameDisplay}</strong>
          </div>
          <div className="topbar-field">
            <span>Role</span>
            <strong>{currentUser?.role ?? "viewer"}</strong>
          </div>
          <div className="topbar-field topbar-field-status">
            <span>Sync</span>
            <strong>
              {getSyncLabel(
                healthQuery.data?.inventorySync,
                syncBackendMutation.isPending,
                syncBackendMutation.isError,
              )}
            </strong>
          </div>
        </div>
        <div className="topbar-actions">
          {isAdmin ? (
            <button
              className="secondary-button"
              disabled={!selectedBackend || syncBackendMutation.isPending}
              onClick={handleSyncSelectedBackend}
              type="button"
            >
              {syncBackendMutation.isPending ? "Syncing..." : "Sync backend zones"}
            </button>
          ) : null}
          <button
            className="primary-button"
            disabled={!selectedZoneName || !canWriteRecords}
            onClick={() => openCreateRecord()}
            type="button"
          >
            Add record
          </button>
          <button
            className="secondary-button"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Workspace sections">
        {workspaceTabs.map((tab) => (
          <button
            key={tab.key}
            aria-current={workspaceTab === tab.key ? "page" : undefined}
            className={
              workspaceTab === tab.key
                ? "workspace-tab workspace-tab-active"
                : "workspace-tab"
            }
            onClick={() => startTransition(() => setWorkspaceTab(tab.key))}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {workspaceNotice ? <div className="workspace-notice">{workspaceNotice}</div> : null}

      {workspaceTab === "records" ? (
        <section className="workspace-layout">
          <section className="workspace-main">
            <div className="section-header section-header-tight">
              <div>
                <p className="section-label">Records</p>
                <h1>Zone inventory</h1>
              </div>
              <p className="section-copy">
                Selected zone, live RRsets, and inline write path on one surface.
              </p>
            </div>

            <div className="records-context-strip" aria-label="Records context">
              <div className="records-context-item">
                <span>Zone</span>
                <strong>{selectedZoneDisplay}</strong>
              </div>
              <div className="records-context-item">
                <span>Backend</span>
                <strong>{selectedBackendTypeDisplay}</strong>
              </div>
              <div className="records-context-item">
                <span>Access</span>
                <strong>{recordsAccessDisplay}</strong>
              </div>
              <div className="records-context-item">
                <span>Sync scope</span>
                <strong>backend-level</strong>
              </div>
            </div>

            {isWorkspaceInitializing ? (
              <div className="empty-state">
                <strong>Preparing workspace</strong>
                <p>Loading accessible zones and backend context for this session.</p>
              </div>
            ) : (
              <>
                <div className="records-toolbar">
                  <input
                    aria-label="Search records"
                    className="records-search"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search by type, name, TTL, or value"
                    value={searchQuery}
                  />
                  <select
                    aria-label="Filter by type"
                    onChange={(event) =>
                      setTypeFilter(event.target.value as "ALL" | RecordType)
                    }
                    value={typeFilter}
                  >
                    <option value="ALL">All types</option>
                    {recordTypeOptions.map((recordType) => (
                      <option key={recordType} value={recordType}>
                        {recordType}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-button"
                    onClick={() => handleSortChange("name")}
                    type="button"
                  >
                    Name {sortKey === "name" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => handleSortChange("type")}
                    type="button"
                  >
                    Type {sortKey === "type" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => handleSortChange("ttl")}
                    type="button"
                  >
                    TTL {sortKey === "ttl" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                  </button>
                  {hasActiveRecordFilters ? (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setSearchQuery("");
                        setTypeFilter("ALL");
                      }}
                      type="button"
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>

                <div className="records-meta-row">
                  <div className="records-meta-group">
                    <span>
                      {sortedRecords.length} shown
                    </span>
                    <span>{records.length} total</span>
                    <span>{selectedRecordKeys.length} selected</span>
                    <span>
                      sort: {sortKey} {sortDirection}
                    </span>
                  </div>
                  <div className="records-meta-group">
                    {recordEditor ? <span>inline editor open</span> : null}
                    {!canWriteRecords ? (
                      <span>
                        Write actions stay disabled until the selected backend exposes
                        `writeRecords`.
                      </span>
                    ) : (
                      <span>edit and duplicate stay on-row for fast changes</span>
                    )}
                    {canWriteRecords ? (
                      <button
                        className="secondary-button secondary-button-danger"
                        disabled={
                          selectedRecordKeys.length === 0 ||
                          bulkChangeMutation.isPending
                        }
                        onClick={() => void handleBulkDeleteSelected()}
                        type="button"
                      >
                        {bulkChangeMutation.isPending
                          ? "Deleting selected..."
                          : `Bulk delete (${selectedRecordKeys.length})`}
                      </button>
                    ) : null}
                  </div>
                </div>

                <section className="records-table" aria-label="Zone records">
                  <div className="records-header">
                    <span>Type</span>
                    <span>Name</span>
                    <span>TTL</span>
                    <span>Value</span>
                    <span>Actions</span>
                  </div>

                  {recordEditor?.mode === "create" ? (
                    <RecordEditorRow
                      canWrite={canWriteRecords}
                      editor={recordEditor}
                      feedback={selectedRowFeedback}
                      isSaving={createRecordMutation.isPending}
                      onCancel={() => {
                        setRecordEditor(null);
                        setRowFeedback(null);
                      }}
                      onChange={setRecordEditor}
                      onSubmit={handleRecordSubmit}
                    />
                  ) : null}

                  {zoneRecordsQuery.isLoading ? (
                    <div className="empty-state">
                      <strong>Loading records…</strong>
                    </div>
                  ) : null}

                  {zoneRecordsQuery.isError ? (
                    <div className="empty-state empty-state-error">
                      <strong>Record inventory failed to load</strong>
                      <p>The API returned an error while listing RRsets for this zone.</p>
                    </div>
                  ) : null}

                  {!zoneRecordsQuery.isLoading &&
                  !zoneRecordsQuery.isError &&
                  sortedRecords.length === 0 ? (
                    <div className="empty-state">
                      <strong>No records match the current filters</strong>
                      <p>Clear search filters or add the first record inline.</p>
                    </div>
                  ) : null}

                  {sortedRecords.map((record) => {
                    const recordKey = getRecordKey(record);
                    const feedback = rowFeedback?.key === recordKey ? rowFeedback : null;

                    if (
                      recordEditor?.mode === "update" &&
                      recordEditor.sourceKey === recordKey
                    ) {
                      return (
                        <RecordEditorRow
                          key={`${recordKey}:editor`}
                          canWrite={canWriteRecords}
                          editor={recordEditor}
                          feedback={feedback}
                          isSaving={updateRecordMutation.isPending}
                          onCancel={() => {
                            setRecordEditor(null);
                            setRowFeedback(null);
                          }}
                          onChange={setRecordEditor}
                          onSubmit={handleRecordSubmit}
                        />
                      );
                    }

                    return (
                      <RecordDisplayRow
                        key={recordKey}
                        canWrite={canWriteRecords}
                        feedback={feedback}
                        isDeleting={deleteRecordMutation.isPending}
                        onDelete={() => handleDeleteRecord(record)}
                        onDuplicate={() => openCreateRecord(record)}
                        onEdit={() => openUpdateRecord(record)}
                        onToggleSelection={() => toggleRecordSelection(recordKey)}
                        record={record}
                        selected={selectedRecordKeys.includes(recordKey)}
                      />
                    );
                  })}
                </section>
              </>
            )}
          </section>

          <aside className="workspace-rail">
            <section className="rail-section">
              <p className="section-label">Zone info</p>
              <div className="summary-line">
                <span>Zone</span>
                <strong>{selectedZoneDisplay}</strong>
              </div>
              <div className="summary-line">
                <span>Records</span>
                <strong>{isWorkspaceInitializing ? "…" : records.length}</strong>
              </div>
              <div className="summary-line">
                <span>Backend</span>
                <strong>{selectedBackendNameDisplay}</strong>
              </div>
              <div className="summary-line">
                <span>Status</span>
                <strong>
                  {getSyncLabel(
                    healthQuery.data?.inventorySync,
                    syncBackendMutation.isPending,
                    syncBackendMutation.isError,
                  )}
                </strong>
              </div>
              <div className="summary-line">
                <span>Access</span>
                <strong>{recordsAccessDisplay}</strong>
              </div>
            </section>

            <section className="rail-section">
              <p className="section-label">Actions</p>
              {isAdmin ? (
                <button
                  className="secondary-button rail-button"
                  disabled={!selectedBackend || syncBackendMutation.isPending}
                  onClick={handleSyncSelectedBackend}
                  type="button"
                >
                  {syncBackendMutation.isPending ? "Syncing..." : "Sync backend zones"}
                </button>
              ) : null}
              <button
                className="primary-button rail-button"
                disabled={!selectedZoneName || !canWriteRecords}
                onClick={() => openCreateRecord()}
                type="button"
              >
                Add record
              </button>
              {!isAdmin ? (
                <p className="helper-copy">
                  Sync stays admin-only because the current API exposes backend sync
                  through admin endpoints only.
                </p>
              ) : (
                <p className="helper-copy">
                  Per-zone sync is not exposed yet, so this triggers the backend-level
                  sync that exists today.
                </p>
              )}
            </section>

            <section className="rail-section">
              <p className="section-label">Backend</p>
              <h2>{isWorkspaceInitializing ? "Loading backend..." : selectedBackend?.name ?? "No backend selected"}</h2>
              <p className="rail-copy">
                {isWorkspaceInitializing
                  ? "Capabilities load after the active zone context is ready."
                  : "Capabilities are rendered exactly as the backend advertises them."}
              </p>
              <div className="summary-line summary-line-compact">
                <span>Type</span>
                <strong>{selectedBackendTypeDisplay}</strong>
              </div>
              <div className="capability-list">
                {(selectedBackend?.capabilities ?? []).map((capability) => (
                  <span key={capability}>{capability}</span>
                ))}
              </div>
              {isAdmin && selectedBackend ? (
                <button
                  className="secondary-button rail-button"
                  onClick={() => {
                    setWorkspaceTab("operations");
                    setEditingBackendName(selectedBackend.name);
                    setBackendName(selectedBackend.name);
                    setBackendType(selectedBackend.backendType);
                    setBackendCapabilities(selectedBackend.capabilities.join(", "));
                  }}
                  type="button"
                >
                  Edit config
                </button>
              ) : null}
            </section>
          </aside>
        </section>
      ) : null}

      {workspaceTab === "operations" ? renderOperationsTab() : null}
      {workspaceTab === "access" ? renderAccessTab() : null}
      {workspaceTab === "auth" ? renderAuthTab() : null}
    </main>
  );
}
