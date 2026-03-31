import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminConsole } from "./AdminConsole";
import { RecordEditorDrawer, type RecordEditorSubmission } from "./RecordEditorDrawer";
import {
  applyBulkZoneChanges,
  assignAdminZoneGrant,
  createAdminBackend,
  createAdminIdentityProvider,
  createZoneRecord,
  deleteAdminBackend,
  deleteAdminIdentityProvider,
  deleteZoneRecord,
  discoverAdminBackendZones,
  fetchAdminBackends,
  fetchAdminIdentityProviders,
  fetchAdminUsers,
  fetchAdminZoneGrants,
  fetchAuditEvents,
  fetchAuthSettings,
  fetchBackends,
  fetchHealth,
  fetchOidcProviders,
  fetchSession,
  hasCookie,
  fetchZone,
  fetchZoneRecords,
  fetchZones,
  importAdminBackendZones,
  login,
  logout,
  previewZoneChange,
  recordTypeSchema,
  startOidcLogin,
  syncAdminBackendZones,
  updateAdminUserRole,
  updateZoneRecord,
  type AdminUser,
  type AuditEvent,
  type Backend,
  type BulkChangeItem,
  type ChangeSetResponse,
  type IdentityProviderConfig,
  type OidcProvider,
  type RecordListResponse,
  type RecordSet,
  type RecordType,
  type Zone,
} from "./api";
import { parseHashRoute, routeToHash, type AppRoute } from "./routes";
import { TutorialProvider, useTutorial } from "./tutorial/TutorialProvider";
import { boolLabel, countLabel, roleLabel, tr, type Locale, type ThemeMode } from "./uiText";
import "./styles.css";

type AdminSection = "backends" | "identity" | "access";
type SortKey = "name" | "type" | "ttl";
type SortDirection = "asc" | "desc";
type Notification = {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  message: string;
  durationMs?: number;
};
type PreviewState =
  | {
      kind: "single";
      title: string;
      confirmLabel: string;
      change: ChangeSetResponse;
      submission:
        | RecordEditorSubmission
        | {
            operation: "delete";
            zoneName: string;
            name: string;
            recordType: RecordType;
            expectedVersion: string;
          };
    }
  | {
      kind: "bulk-delete";
      title: string;
      confirmLabel: string;
      zoneName: string;
      records: RecordSet[];
      items: BulkChangeItem[];
    };

const emptyAdminUsers: AdminUser[] = [];
const emptyBackends: Backend[] = [];
const emptyIdentityProviders: IdentityProviderConfig[] = [];
const emptyAuditEvents: AuditEvent[] = [];
const emptyRecords: RecordSet[] = [];
const emptyZones: Zone[] = [];
const recordTypeOptions = recordTypeSchema.options as readonly RecordType[];
const THEME_STORAGE_KEY = "zonix.theme";
const LOCALE_STORAGE_KEY = "zonix.locale";

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "dark";
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") {
    return "en";
  }
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "ru" || stored === "en" ? stored : "en";
}

function triggerThemeWave(themeMode: ThemeMode, origin: HTMLElement) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const rect = origin.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const radius = Math.hypot(
    Math.max(centerX, window.innerWidth - centerX),
    Math.max(centerY, window.innerHeight - centerY),
  );
  const overlay = document.createElement("div");
  overlay.className = `theme-wave-overlay theme-wave-overlay-${themeMode}`;
  overlay.style.setProperty("--wave-x", `${centerX}px`);
  overlay.style.setProperty("--wave-y", `${centerY}px`);
  overlay.style.setProperty("--wave-radius", `${radius}px`);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add("theme-wave-overlay-active");
  });
  window.setTimeout(() => overlay.remove(), 1120);
}

function compareRecordSets(left: RecordSet, right: RecordSet) {
  return (
    left.name.localeCompare(right.name) ||
    left.recordType.localeCompare(right.recordType)
  );
}

function isSameRecordSet(
  left: Pick<RecordSet, "zoneName" | "name" | "recordType">,
  right: Pick<RecordSet, "zoneName" | "name" | "recordType">,
) {
  return (
    left.zoneName === right.zoneName &&
    left.name === right.name &&
    left.recordType === right.recordType
  );
}

function upsertRecordListItem(
  current: RecordListResponse | undefined,
  nextRecord: RecordSet,
): RecordListResponse | undefined {
  if (!current) {
    return current;
  }

  return {
    items: [...current.items.filter((item) => !isSameRecordSet(item, nextRecord)), nextRecord].sort(
      compareRecordSets,
    ),
  };
}

function removeRecordListItem(
  current: RecordListResponse | undefined,
  target: Pick<RecordSet, "zoneName" | "name" | "recordType">,
): RecordListResponse | undefined {
  if (!current) {
    return current;
  }

  return {
    items: current.items.filter((item) => !isSameRecordSet(item, target)),
  };
}

const adminSectionMeta: Record<
  AdminSection,
  { label: string; description: string }
> = {
  backends: {
    label: "Backend config",
    description:
      "Register backends, inspect capabilities, and run discovery or sync without leaving the product.",
  },
  access: {
    label: "Users and grants",
    description:
      "Manage global roles and zone grants from the same surface as the selected DNS zone.",
  },
  identity: {
    label: "Identity providers",
    description:
      "Keep auth posture visible while managing external identity providers and mapping rules.",
  },
};

function normalizeCommaSeparatedList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRecordKey(record: Pick<RecordSet, "name" | "recordType">) {
  return `${record.name}:${record.recordType}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function StatePanel(props: {
  action?: ReactNode;
  eyebrow?: string;
  message: string;
  tone?: "default" | "error" | "loading";
  title: string;
}) {
  const toneClass =
    props.tone === "error"
      ? "empty-state empty-state-error"
      : props.tone === "loading"
        ? "empty-state empty-state-loading"
        : "empty-state";

  return (
    <div className={toneClass} role={props.tone === "error" ? "alert" : "status"}>
      {props.eyebrow ? <span className="empty-state-eyebrow">{props.eyebrow}</span> : null}
      <strong>{props.title}</strong>
      <p>{props.message}</p>
      {props.action ? <div className="empty-state-actions">{props.action}</div> : null}
    </div>
  );
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
      sortKey === "name" ? right.name.toLowerCase() : right.recordType.toLowerCase();
    return leftValue.localeCompare(rightValue) * direction;
  });
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function humanizeAuditAction(action: string, locale: Locale = "en") {
  const labels: Record<string, string> = {
    "login.success": locale === "ru" ? "Успешный вход" : "Successful login",
    "login.failed": locale === "ru" ? "Неудачный вход" : "Failed login",
    "logout.success": locale === "ru" ? "Выход из сессии" : "Logout",
    "record.created": locale === "ru" ? "Запись создана" : "Record created",
    "record.updated": locale === "ru" ? "Запись обновлена" : "Record updated",
    "record.deleted": locale === "ru" ? "Запись удалена" : "Record deleted",
  };

  return labels[action] ?? action;
}

function humanizeAuditPayloadKey(key: string, locale: Locale = "en") {
  const labels: Record<string, string> = {
    role: locale === "ru" ? "Роль" : "Role",
    authSource: locale === "ru" ? "Источник входа" : "Auth source",
    ttl: "TTL",
    name: locale === "ru" ? "Имя" : "Name",
    values: locale === "ru" ? "Значения" : "Values",
    recordType: locale === "ru" ? "Тип записи" : "Record type",
    afterVersion: locale === "ru" ? "Версия после" : "After version",
    beforeVersion: locale === "ru" ? "Версия до" : "Before version",
    reason: locale === "ru" ? "Причина" : "Reason",
  };

  return labels[key] ?? key;
}

function humanizeAuditPayloadValue(
  key: string,
  value: unknown,
  locale: Locale = "en",
) {
  if (key === "role" && typeof value === "string") {
    return roleLabel(locale, value);
  }
  if (key === "authSource" && typeof value === "string") {
    if (locale === "ru") {
      return value === "local" ? "локальный" : value;
    }
    return value;
  }
  return String(value);
}

function formatPayload(payload: Record<string, unknown>, locale: Locale = "en") {
  return Object.entries(payload)
    .map(([key, value]) => {
      const readableKey = humanizeAuditPayloadKey(key, locale);
      const readableValue = humanizeAuditPayloadValue(key, value, locale);
      return `${readableKey}: ${readableValue}`;
    })
    .join(" · ");
}

function getPayloadEntries(payload: Record<string, unknown>, locale: Locale = "en") {
  return Object.entries(payload).map(([key, value]) => [
    humanizeAuditPayloadKey(key, locale),
    humanizeAuditPayloadValue(key, value, locale),
  ] as const);
}

function getAuditAuthSource(event: AuditEvent) {
  const authSource = event.payload.authSource;
  return typeof authSource === "string" && authSource.trim().length > 0
    ? authSource.trim()
    : null;
}

function formatAuditAuthSource(authSource: string, locale: Locale = "en") {
  if (authSource === "local") {
    return locale === "ru" ? "Локальный вход" : "Local auth";
  }
  if (authSource.startsWith("oidc:")) {
    const providerName = authSource.slice("oidc:".length) || "OIDC";
    return locale === "ru" ? `OIDC · ${providerName}` : `OIDC · ${providerName}`;
  }
  return authSource;
}

function humanizeCapability(capability: string, locale: Locale = "en") {
  const labels: Record<string, string> = {
    discoverZones: locale === "ru" ? "Обнаружение" : "Discovery",
    readZones: locale === "ru" ? "Метаданные зоны" : "Zone metadata",
    readRecords: locale === "ru" ? "Чтение записей" : "Record reads",
    writeRecords: locale === "ru" ? "Запись записей" : "Record writes",
    commentsMetadata: locale === "ru" ? "Комментарии" : "Comments",
    importSnapshot: locale === "ru" ? "Импорт snapshot" : "Snapshot import",
    axfr: "AXFR",
    rfc2136Update: locale === "ru" ? "Обновление RFC2136" : "RFC2136 update",
  };

  return labels[capability] ?? capability;
}

function summarizeCapabilities(capabilities: string[], locale: Locale = "en") {
  const readable = capabilities.includes("readRecords");
  const writable = capabilities.includes("writeRecords");
  const discoverable = capabilities.includes("discoverZones");
  const importable = capabilities.includes("importSnapshot");

  if (readable && writable && discoverable) {
    return locale === "ru" ? "Полный контур инвентаря и записи" : "Full inventory and write path";
  }
  if (readable && writable) {
    return locale === "ru" ? "Чтение и запись записей" : "Read/write record operations";
  }
  if (readable && discoverable) {
    return locale === "ru" ? "Чтение с поддержкой обнаружения" : "Readable with discovery support";
  }
  if (readable && importable) {
    return locale === "ru" ? "Чтение через импортированные snapshot" : "Readable via imported snapshots";
  }
  if (readable) {
    return locale === "ru" ? "Видимость записей только для чтения" : "Read-only record visibility";
  }
  if (discoverable) {
    return locale === "ru" ? "Только обнаружение" : "Discovery only";
  }
  return locale === "ru" ? "Ограниченный набор возможностей" : "Limited capability surface";
}

function formatBackendTypeLabel(backendType: string) {
  if (backendType === "powerdns") {
    return "PowerDNS";
  }
  if (backendType === "rfc2136-bind") {
    return "RFC2136 / BIND";
  }
  return backendType;
}

function getUserInitials(username: string) {
  return username
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

function getBackendAccessLabel(capabilities: string[], locale: Locale = "en") {
  if (capabilities.includes("writeRecords")) {
    return locale === "ru" ? "чтение/запись" : "read/write";
  }
  if (capabilities.includes("readRecords")) {
    return locale === "ru" ? "только чтение" : "read-only";
  }
  return locale === "ru" ? "недоступно" : "unavailable";
}

function RouteLink(props: {
  active: boolean;
  children: string;
  dataTour?: string;
  href: string;
  hidden?: boolean;
}) {
  if (props.hidden) {
    return null;
  }

  return (
    <a
      aria-current={props.active ? "page" : undefined}
      className={props.active ? "side-nav-link side-nav-link-active" : "side-nav-link"}
      data-tour={props.dataTour}
      href={props.href}
    >
      {props.children}
    </a>
  );
}

function CapabilityBadge(props: { capability: string; locale?: Locale }) {
  return <span className="capability-badge">{humanizeCapability(props.capability, props.locale)}</span>;
}

function NotificationTray(props: {
  items: Notification[];
  locale: Locale;
  onDismiss: (id: number) => void;
}) {
  if (props.items.length === 0) {
    return null;
  }

  return (
    <div className="notification-tray" aria-atomic="true" aria-live="polite">
      {props.items.map((item) => (
        <div
          key={item.id}
          className={`notification-card notification-card-${item.kind}`}
          role={item.kind === "error" ? "alert" : "status"}
        >
          <div>
            <strong>{item.title}</strong>
            <p>{item.message}</p>
          </div>
          <button
            aria-label={
              props.locale === "ru" ? `Закрыть уведомление ${item.title}` : `Dismiss ${item.title}`
            }
            className="secondary-button"
            onClick={() => props.onDismiss(item.id)}
            type="button"
          >
            {tr(props.locale, "Close")}
          </button>
        </div>
      ))}
    </div>
  );
}

function TutorialLauncherButton() {
  const tutorial = useTutorial();

  return (
    <button
      className="secondary-button"
      data-tour="shell-tutorial-launcher"
      onClick={tutorial.openHub}
      type="button"
    >
      {tutorial.launcherLabel}
    </button>
  );
}

function PreviewModal(props: {
  locale: Locale;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  state: PreviewState | null;
}) {
  if (!props.state) {
    return null;
  }

  return (
    <div className="overlay-shell" role="presentation">
      <div className="overlay-backdrop" onClick={props.onCancel} />
      <section
        className="overlay-panel"
        aria-label={props.locale === "ru" ? "Предпросмотр изменений" : "Change preview"}
      >
        <div className="overlay-panel-header">
          <div>
            <p className="section-label">{tr(props.locale, "Diff preview")}</p>
            <h2>{props.state.title}</h2>
          </div>
          <button className="secondary-button" onClick={props.onCancel} type="button">
            {tr(props.locale, "Close")}
          </button>
        </div>

        {props.state.kind === "single" ? (
          <div className="preview-stack">
            <div className="preview-meta">
              <span>{tr(props.locale, "Operation")}</span>
              <strong>{props.state.change.operation}</strong>
            </div>
            <div className="preview-meta">
              <span>{tr(props.locale, "Backend")}</span>
              <strong>{props.state.change.backendName}</strong>
            </div>
            <div className="preview-meta">
              <span>{tr(props.locale, "Summary")}</span>
              <strong>{props.state.change.summary}</strong>
            </div>
            <div className="preview-grid">
              <article className="preview-card">
                <p className="section-label">{tr(props.locale, "Before")}</p>
                {props.state.change.before ? (
                  <>
                    <strong>
                      {props.state.change.before.name} {props.state.change.before.recordType}
                    </strong>
                    <span>TTL {props.state.change.before.ttl}</span>
                    <code>{props.state.change.before.values.join("\n")}</code>
                  </>
                ) : (
                  <p className="helper-copy">
                    {props.locale === "ru" ? "Предыдущей записи не было." : "No previous record existed."}
                  </p>
                )}
              </article>
              <article className="preview-card">
                <p className="section-label">{tr(props.locale, "After")}</p>
                {props.state.change.after ? (
                  <>
                    <strong>
                      {props.state.change.after.name} {props.state.change.after.recordType}
                    </strong>
                    <span>TTL {props.state.change.after.ttl}</span>
                    <code>{props.state.change.after.values.join("\n")}</code>
                  </>
                ) : (
                  <p className="helper-copy">
                    {props.locale === "ru" ? "Запись будет удалена." : "The record will be removed."}
                  </p>
                )}
              </article>
            </div>
            {props.state.change.hasConflict ? (
              <div className="status-callout status-callout-warning">
                <strong>{tr(props.locale, "Conflict detected")}</strong>
                <p>
                  {props.state.change.conflictReason ??
                    (props.locale === "ru"
                      ? "Бэкенд сообщил о конфликте версии."
                      : "Backend reported a version conflict.")}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="preview-stack">
            <p className="helper-copy">
              {props.locale === "ru" ? "Следующие RRset будут удалены из " : "The following RRsets will be deleted from "}
              <strong>{props.state.zoneName}</strong>.
            </p>
            <div className="preview-list">
              {props.state.records.map((record) => (
                <article key={getRecordKey(record)} className="preview-card">
                  <strong>
                    {record.name} {record.recordType}
                  </strong>
                  <span>TTL {record.ttl}</span>
                  <code>{record.values.join("\n")}</code>
                </article>
              ))}
            </div>
          </div>
        )}

        <div className="overlay-actions">
          <button className="primary-button" onClick={props.onConfirm} type="button">
              {props.pending ? (props.locale === "ru" ? "Применение…" : "Applying…") : props.state.confirmLabel}
          </button>
          <button
            className="secondary-button"
            disabled={props.pending}
            onClick={props.onCancel}
            type="button"
          >
            {tr(props.locale, "Cancel")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ZonesPage(props: {
  activeZoneName: string | null;
  availableBackends: Backend[];
  currentRole: string | null;
  error: unknown;
  loading: boolean;
  locale: Locale;
  onOpenZone: (zoneName: string) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  zones: Zone[];
}) {
  const backendCount = new Set(props.zones.map((zone) => zone.backendName)).size;
  const writableZoneCount =
    props.currentRole === "viewer"
      ? 0
      : props.zones.filter((zone) =>
          props.availableBackends
            .find((backend) => backend.name === zone.backendName)
            ?.capabilities.includes("writeRecords"),
        ).length;

  return (
    <section className="page-stack">
      <section className="inventory-hero inventory-hero-zones">
        <div className="inventory-hero-copy">
          <p className="section-label">{tr(props.locale, "Zones")}</p>
          <h1>{tr(props.locale, "Zone inventory")}</h1>
          <p className="section-copy">
            {props.locale === "ru"
              ? "Начинайте с управляемого списка зон, сразу видьте владельца namespace и переходите к записям без потери операторского контекста."
              : "Start from the managed zone list, see which backend owns each namespace, and jump straight into record-level work without losing operator context."}
          </p>
        </div>
        <div className="inventory-hero-aside">
          <div className="inventory-stat-card">
            <span>{tr(props.locale, "Total visible zones")}</span>
            <strong>{props.zones.length}</strong>
          </div>
          <div className="inventory-stat-card">
            <span>{tr(props.locale, "Writable workspaces")}</span>
            <strong>{writableZoneCount}</strong>
          </div>
          <div className="inventory-stat-card">
            <span>{tr(props.locale, "Backends in scope")}</span>
            <strong>{backendCount}</strong>
          </div>
          <div className="inventory-stat-card">
            <span>{tr(props.locale, "Current focus")}</span>
            <strong>{props.activeZoneName ?? tr(props.locale, "Pick a zone")}</strong>
          </div>
        </div>
      </section>

      <section className="inventory-toolbar">
        <label className="search-field inventory-search">
          <span>{tr(props.locale, "Search zones")}</span>
          <input
            aria-label={tr(props.locale, "Search zones")}
            data-tour="zones-search"
            onChange={(event) => props.setSearchQuery(event.target.value)}
            placeholder={tr(props.locale, "Filter by zone or backend")}
            value={props.searchQuery}
          />
        </label>
        <div className="inventory-toolbar-note">
          <strong>{tr(props.locale, "Operator scope")}</strong>
          <p>
            {props.locale === "ru"
              ? "Здесь показаны только зоны, доступные текущей сессии. Админский конфиг бэкендов остаётся на отдельных страницах."
              : "Only zones available to the current session are shown here. Admin-only backend config stays isolated on dedicated pages."}
          </p>
        </div>
      </section>

      {props.loading ? (
        <StatePanel
          eyebrow="Inventory"
          message="Refreshing the visible zone inventory and backend ownership map."
          title="Loading zones"
          tone="loading"
        />
      ) : props.error ? (
        <StatePanel
          eyebrow="Inventory"
          message={getErrorMessage(
            props.error,
            "The zone inventory could not be loaded for this session.",
          )}
          title="Zone inventory is unavailable"
          tone="error"
        />
      ) : props.zones.length === 0 ? (
        props.searchQuery.trim().length > 0 ? (
          <StatePanel
            action={
              <button
                className="secondary-button"
                onClick={() => props.setSearchQuery("")}
                type="button"
              >
                Clear search
              </button>
            }
            eyebrow="Inventory"
            message={`Nothing matched "${props.searchQuery.trim()}". Try a zone name or backend instead.`}
            title="No zones match this search"
          />
        ) : (
          <StatePanel
            eyebrow="Inventory"
            message="Sync a backend or import zones before opening the zone workspace."
            title="No zones are available"
          />
        )
      ) : (
        <div className="zone-grid">
          {props.zones.map((zone, index) => (
            <button
              key={zone.name}
              className={
                props.activeZoneName === zone.name ? "zone-card zone-card-active" : "zone-card"
              }
              data-zone-name={zone.name}
              data-tour={index === 0 ? "zones-primary-card" : undefined}
              onClick={() => props.onOpenZone(zone.name)}
              type="button"
            >
              <div className="zone-card-topline">
                <span className="zone-card-kicker">{tr(props.locale, "managed zone")}</span>
                <span
                  className={
                    props.activeZoneName === zone.name
                      ? "zone-card-status zone-card-status-active"
                      : "zone-card-status"
                  }
                >
                  {props.activeZoneName === zone.name
                    ? tr(props.locale, "Open now")
                    : tr(props.locale, "Available")}
                </span>
              </div>
              <div className="zone-card-heading">
                <strong>{zone.name}</strong>
                <span>{zone.backendName}</span>
              </div>
              <div className="zone-card-meta">
                <span>
                  {formatBackendTypeLabel(
                    props.availableBackends.find((backend) => backend.name === zone.backendName)
                      ?.backendType ?? "backend",
                  )}
                </span>
                <span>
                  {props.currentRole === "viewer"
                    ? tr(props.locale, "read-only session")
                    : props.availableBackends
                        .find((backend) => backend.name === zone.backendName)
                        ?.capabilities.includes("writeRecords")
                      ? tr(props.locale, "write path enabled")
                      : tr(props.locale, "read-only backend")}
                </span>
              </div>
              <p>{tr(props.locale, "Open zone detail for records, diff previews, and permission-aware actions.")}</p>
              <div className="zone-card-footer">
                <span>{tr(props.locale, "Open zone workspace")}</span>
                <strong>{props.activeZoneName === zone.name ? tr(props.locale, "Active now") : tr(props.locale, "View records")}</strong>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === "undefined" ? { kind: "zones" } : parseHashRoute(window.location.hash),
  );
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredTheme);
  const [locale, setLocale] = useState<Locale>(readStoredLocale);
  const [localeAnimating, setLocaleAnimating] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [zoneSearch, setZoneSearch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const deferredRecordSearch = useDeferredValue(recordSearch);
  const [typeFilter, setTypeFilter] = useState<"ALL" | RecordType>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedRecordKeys, setSelectedRecordKeys] = useState<string[]>([]);
  const [editorState, setEditorState] = useState<{
    mode: "create" | "update";
    record?: RecordSet | null;
  } | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [selectedGrantUsername, setSelectedGrantUsername] = useState<string | null>(null);
  const [selectedGrantZoneName, setSelectedGrantZoneName] = useState<string | null>(null);
  const [selectedUserRole, setSelectedUserRole] = useState<
    "admin" | "editor" | "viewer"
  >("viewer");
  const [editingBackendName, setEditingBackendName] = useState<string | null>(null);
  const [isCreatingBackend, setIsCreatingBackend] = useState(false);
  const [backendName, setBackendName] = useState("");
  const [backendType, setBackendType] = useState("powerdns");
  const [backendCapabilities, setBackendCapabilities] = useState(
    "readZones, readRecords, writeRecords",
  );
  const [editingProviderName, setEditingProviderName] = useState<string | null>(null);
  const [isCreatingProvider, setIsCreatingProvider] = useState(false);
  const [providerName, setProviderName] = useState("");
  const [providerIssuer, setProviderIssuer] = useState("https://issuer.example");
  const [providerClientId, setProviderClientId] = useState("zonix-ui");
  const [providerClientSecret, setProviderClientSecret] = useState("");
  const [providerScopes, setProviderScopes] = useState("openid, profile, email");
  const [providerClaimsRules, setProviderClaimsRules] = useState(
    '{\n  "usernameClaim": "preferred_username",\n  "rolesClaim": "groups"\n}',
  );
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [grantActions, setGrantActions] = useState<string[]>(["read"]);
  const [discoveryBackendName, setDiscoveryBackendName] = useState("");
  const [discoveredZoneNames, setDiscoveredZoneNames] = useState<string[]>([]);
  const [lastDiscoveredBackendName, setLastDiscoveredBackendName] = useState<
    string | null
  >(null);
  const [lastDiscoveredZones, setLastDiscoveredZones] = useState<Zone[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditActorFilter, setAuditActorFilter] = useState("ALL");
  const [auditZoneFilter, setAuditZoneFilter] = useState("ALL");
  const localeClassName = localeAnimating ? "locale-switching" : "";

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleHashChange = () => {
      startTransition(() => setRoute(parseHashRoute(window.location.hash)));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.dataset.locale = locale;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale, themeMode]);

  useEffect(() => {
    if (!localeAnimating) {
      return undefined;
    }
    const timer = window.setTimeout(() => setLocaleAnimating(false), 220);
    return () => window.clearTimeout(timer);
  }, [localeAnimating]);

  useEffect(() => {
    if (notifications.length === 0) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setNotifications((current) => current.slice(1));
    }, notifications[0]?.durationMs ?? 4500);
    return () => window.clearTimeout(timer);
  }, [notifications]);

  function pushNotification(
    kind: Notification["kind"],
    title: string,
    message: string,
    durationMs?: number,
  ) {
    setNotifications((current) => [
      ...current,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        kind,
        title,
        message,
        durationMs,
      },
    ]);
  }

  function dismissNotification(id: number) {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }

  function handleThemeToggle(origin: HTMLButtonElement) {
    const nextTheme = themeMode === "dark" ? "light" : "dark";
    if (typeof document === "undefined" || typeof window === "undefined") {
      setThemeMode(nextTheme);
      return;
    }

    const rect = origin.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = Math.hypot(
      Math.max(centerX, window.innerWidth - centerX),
      Math.max(centerY, window.innerHeight - centerY),
    );
    const root = document.documentElement;
    root.style.setProperty("--theme-wave-x", `${centerX}px`);
    root.style.setProperty("--theme-wave-y", `${centerY}px`);
    root.style.setProperty("--theme-wave-radius", `${radius}px`);

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startViewTransition = document.startViewTransition?.bind(document);

    if (!startViewTransition || prefersReducedMotion) {
      triggerThemeWave(nextTheme, origin);
      setThemeMode(nextTheme);
      return;
    }

    const transition = startViewTransition(() => {
      flushSync(() => setThemeMode(nextTheme));
    });

    transition.ready
      .then(() => {
        root.dataset.themeTransition = "radial";
      })
      .catch(() => {
        root.removeAttribute("data-theme-transition");
      });

    transition.finished.finally(() => {
      root.removeAttribute("data-theme-transition");
    });
  }

  function navigate(nextRoute: AppRoute) {
    if (typeof window === "undefined") {
      setRoute(nextRoute);
      return;
    }

    const hash = routeToHash(nextRoute);
    if (window.location.hash === hash) {
      setRoute(nextRoute);
      return;
    }

    window.location.hash = hash;
  }

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
    enabled: authSettingsQuery.isSuccess && hasCookie("zonix_csrf_token"),
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
  const adminBackendsQuery = useQuery({
    queryKey: ["admin-backends"],
    queryFn: fetchAdminBackends,
    enabled: isAuthenticated && isAdmin,
    retry: false,
  });
  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: fetchZones,
    enabled: isAuthenticated,
    retry: false,
  });

  const activeZoneName = route.kind === "zone" ? route.zoneName : null;
  const jumpZoneName =
    route.kind === "zone" ? route.zoneName : zonesQuery.data?.items[0]?.name ?? "";

  const zoneDetailQuery = useQuery({
    queryKey: ["zone", activeZoneName],
    queryFn: () => fetchZone(activeZoneName as string),
    enabled: isAuthenticated && route.kind === "zone" && activeZoneName !== null,
    retry: false,
  });
  const zoneRecordsQuery = useQuery({
    queryKey: ["zone-records", activeZoneName],
    queryFn: () => fetchZoneRecords(activeZoneName as string),
    enabled: isAuthenticated && route.kind === "zone" && activeZoneName !== null,
    retry: false,
  });
  const auditEventsQuery = useQuery({
    queryKey: ["audit-events"],
    queryFn: () => fetchAuditEvents(250),
    enabled: isAuthenticated && route.kind === "audit",
    retry: false,
  });
  const adminUsersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: fetchAdminUsers,
    enabled: isAuthenticated && isAdmin,
    retry: false,
  });
  const adminIdentityProvidersQuery = useQuery({
    queryKey: ["admin-identity-providers"],
    queryFn: fetchAdminIdentityProviders,
    enabled: isAuthenticated && isAdmin,
    retry: false,
  });
  const adminZoneGrantsQuery = useQuery({
    queryKey: ["admin-zone-grants", selectedGrantUsername],
    queryFn: () => fetchAdminZoneGrants(selectedGrantUsername as string),
    enabled: isAuthenticated && isAdmin && selectedGrantUsername !== null,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async (nextSession) => {
      queryClient.setQueryData(["session"], nextSession);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
      ]);
      pushNotification("success", "Session ready", "Login succeeded.", 1800);
    },
    onError: (error) => {
      pushNotification(
        "error",
        "Login failed",
        getErrorMessage(error, "Invalid username or password."),
      );
    },
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async (nextSession) => {
      await queryClient.cancelQueries({ queryKey: ["session"] });
      queryClient.setQueryData(["session"], nextSession);
      for (const key of [
        "backends",
        "admin-backends",
        "zones",
        "zone",
        "zone-records",
        "audit-events",
        "admin-users",
        "admin-zone-grants",
        "admin-identity-providers",
      ]) {
        queryClient.removeQueries({ queryKey: [key] });
      }
      setSelectedRecordKeys([]);
      setEditorState(null);
      setPreviewState(null);
      setPassword("");
      navigate({ kind: "zones" });
      pushNotification("info", "Signed out", "The active session has been closed.");
    },
  });
  const oidcLoginMutation = useMutation({
    mutationFn: startOidcLogin,
    onSuccess: ({ authorizationUrl }) => {
      window.location.assign(authorizationUrl);
    },
    onError: (error) => {
      pushNotification(
        "error",
        "OIDC start failed",
        getErrorMessage(error, "OIDC login could not be started."),
      );
    },
  });
  const previewMutation = useMutation({
    mutationFn: previewZoneChange,
    onError: (error) => {
      pushNotification(
        "error",
        "Preview failed",
        getErrorMessage(error, "The backend could not preview the requested change."),
      );
    },
  });
  const createRecordMutation = useMutation({
    mutationFn: createZoneRecord,
    onSuccess: async (record) => {
      queryClient.setQueryData<RecordListResponse | undefined>(
        ["zone-records", record.zoneName],
        (current) => upsertRecordListItem(current, record),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-records", record.zoneName] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
      pushNotification(
        "success",
        "Record created",
        `${record.name} ${record.recordType} was added to ${record.zoneName}.`,
      );
    },
    onError: (error) => {
      pushNotification(
        "error",
        "Create failed",
        getErrorMessage(error, "The backend rejected the new record."),
      );
    },
  });
  const updateRecordMutation = useMutation({
    mutationFn: updateZoneRecord,
    onSuccess: async (record) => {
      queryClient.setQueryData<RecordListResponse | undefined>(
        ["zone-records", record.zoneName],
        (current) => upsertRecordListItem(current, record),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-records", record.zoneName] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
      pushNotification(
        "success",
        "Record updated",
        `${record.name} ${record.recordType} is now in sync.`,
      );
    },
    onError: (error) => {
      pushNotification(
        "error",
        "Update failed",
        getErrorMessage(error, "The backend rejected the update."),
      );
    },
  });
  const deleteRecordMutation = useMutation({
    mutationFn: deleteZoneRecord,
    onSuccess: async (_, variables) => {
      queryClient.setQueryData<RecordListResponse | undefined>(
        ["zone-records", variables.zoneName],
        (current) => removeRecordListItem(current, variables),
      );
      setSelectedRecordKeys((current) =>
        current.filter(
          (key) =>
            key !== `${variables.zoneName}:${variables.name}:${variables.recordType}`,
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-records", variables.zoneName] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
      pushNotification(
        "success",
        "Record deleted",
        `${variables.name} ${variables.recordType} was removed from ${variables.zoneName}.`,
      );
    },
    onError: (error) => {
      pushNotification(
        "error",
        "Delete failed",
        getErrorMessage(error, "The backend rejected the delete."),
      );
    },
  });
  const bulkChangeMutation = useMutation({
    mutationFn: applyBulkZoneChanges,
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-records", response.zoneName] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
      setSelectedRecordKeys([]);
      pushNotification(
        "success",
        "Bulk changes applied",
        `${response.items.length} record changes were committed.`,
      );
    },
    onError: (error) => {
      pushNotification(
        "error",
        "Bulk apply failed",
        getErrorMessage(error, "The backend rejected the requested bulk changes."),
      );
    },
  });
  const syncBackendMutation = useMutation({
    mutationFn: syncAdminBackendZones,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
      ]);
      pushNotification(
        "success",
        "Backend synced",
        `${result.syncedZones.length} zones refreshed from ${result.backendName}.`,
      );
    },
    onError: (error) => {
      pushNotification(
        "error",
        "Backend sync failed",
        getErrorMessage(error, "Zone sync failed."),
      );
    },
  });
  const createBackendMutation = useMutation({
    mutationFn: createAdminBackend,
    onSuccess: async (backend) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
      ]);
      setIsCreatingBackend(false);
      setEditingBackendName(backend.name);
      setBackendName(backend.name);
      setBackendType(backend.backendType);
      setBackendCapabilities(backend.capabilities.join(", "));
      pushNotification(
        "success",
        locale === "ru" ? "Бэкенд сохранён" : "Backend saved",
        locale === "ru"
          ? `${backend.name} готов к обнаружению и синхронизации.`
          : `${backend.name} is ready for discovery and sync.`,
      );
    },
    onError: (error) => {
      pushNotification(
        "error",
        locale === "ru" ? "Не удалось сохранить бэкенд" : "Backend save failed",
        getErrorMessage(
          error,
          locale === "ru"
            ? "Не удалось сохранить конфиг бэкенда."
            : "Backend config could not be saved.",
        ),
      );
    },
  });
  const deleteBackendMutation = useMutation({
    mutationFn: deleteAdminBackend,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-backends"] }),
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
      ]);
      setIsCreatingBackend(false);
      setEditingBackendName(null);
      pushNotification(
        "success",
        locale === "ru" ? "Бэкенд удалён" : "Backend deleted",
        locale === "ru" ? "Конфиг бэкенда удалён." : "Backend config was removed.",
      );
    },
  });
  const createIdentityProviderMutation = useMutation({
    mutationFn: createAdminIdentityProvider,
    onSuccess: async (provider) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-identity-providers"] });
      setIsCreatingProvider(false);
      setEditingProviderName(provider.name);
      setProviderName(provider.name);
      setProviderIssuer(provider.issuer);
      setProviderClientId(provider.clientId);
      setProviderClientSecret("");
      setProviderScopes(provider.scopes.join(", "));
      setProviderClaimsRules(JSON.stringify(provider.claimsMappingRules, null, 2));
      pushNotification(
        "success",
        locale === "ru" ? "Провайдер входа сохранён" : "Identity provider saved",
        locale === "ru"
          ? `${provider.name} теперь доступен для входа через OIDC.`
          : `${provider.name} is now available for OIDC login.`,
      );
    },
    onError: (error) => {
      pushNotification(
        "error",
        locale === "ru"
          ? "Не удалось сохранить провайдера входа"
          : "Identity provider save failed",
        getErrorMessage(
          error,
          locale === "ru"
            ? "Не удалось сохранить конфиг провайдера входа."
            : "Identity provider config could not be saved.",
        ),
      );
    },
  });
  const deleteIdentityProviderMutation = useMutation({
    mutationFn: deleteAdminIdentityProvider,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-identity-providers"] });
      setIsCreatingProvider(false);
      setEditingProviderName(null);
      pushNotification(
        "success",
        locale === "ru" ? "Провайдер входа удалён" : "Identity provider deleted",
        locale === "ru" ? "Выбранный провайдер удалён." : "The selected provider was removed.",
      );
    },
  });
  const updateUserRoleMutation = useMutation({
    mutationFn: updateAdminUserRole,
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      pushNotification(
        "success",
        locale === "ru" ? "Глобальная роль обновлена" : "Global role updated",
        locale === "ru"
          ? `${user.username} теперь ${roleLabel(locale, user.role)}.`
          : `${user.username} is now ${user.role}.`,
      );
    },
  });
  const assignGrantMutation = useMutation({
    mutationFn: assignAdminZoneGrant,
    onSuccess: async (grant) => {
      await queryClient.invalidateQueries({
        queryKey: ["admin-zone-grants", grant.username],
      });
      pushNotification(
        "success",
        locale === "ru" ? "Права на зону сохранены" : "Zone grant saved",
        locale === "ru"
          ? `${grant.username} теперь имеет ${grant.actions
              .map((action) =>
                action === "read" ? "чтение" : action === "write" ? "запись" : "делегирование",
              )
              .join(", ")} для ${grant.zoneName}.`
          : `${grant.username} now has ${grant.actions.join(", ")} on ${grant.zoneName}.`,
      );
    },
  });
  const discoverZonesMutation = useMutation({
    mutationFn: discoverAdminBackendZones,
    onSuccess: (response) => {
      setLastDiscoveredBackendName(response.backendName);
      setLastDiscoveredZones(
        response.items.map((zone) => ({
          name: zone.name,
          backendName: zone.backendName,
        })),
      );
      setDiscoveredZoneNames(
        response.items.filter((zone) => !zone.managed).map((zone) => zone.name),
      );
      pushNotification(
        "info",
        "Discovery complete",
        `${response.items.length} zones reviewed for ${response.backendName}.`,
      );
    },
  });
  const importZonesMutation = useMutation({
    mutationFn: importAdminBackendZones,
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["zones"] });
      setDiscoveredZoneNames([]);
      pushNotification(
        "success",
        "Zones imported",
        `${response.importedZones.length} zones are now managed by Zonix.`,
      );
    },
  });

  const zones = zonesQuery.data?.items ?? emptyZones;
  const visibleBackends = isAdmin
    ? adminBackendsQuery.data?.items ?? backendsQuery.data?.items ?? emptyBackends
    : backendsQuery.data?.items ?? emptyBackends;
  const shellCountLabels = useMemo(
    () => ({
      zones: countLabel(locale, zones.length, {
        en: ["zone", "zones"],
        ru: ["зона", "зоны", "зон"],
      }),
      backends: countLabel(locale, visibleBackends.length, {
        en: ["backend", "backends"],
        ru: ["бэкенд", "бэкенда", "бэкендов"],
      }),
    }),
    [locale, visibleBackends.length, zones.length],
  );
  const discoverableBackends = visibleBackends.filter((backend) =>
    backend.capabilities.includes("discoverZones"),
  );
  const activeZone =
    zones.find((zone) => zone.name === activeZoneName) ??
    (zoneDetailQuery.data
      ? {
          name: zoneDetailQuery.data.name,
          backendName: zoneDetailQuery.data.backendName,
        }
      : null);
  const selectedBackend =
    visibleBackends.find((backend) => backend.name === activeZone?.backendName) ?? null;
  const records = zoneRecordsQuery.data?.items ?? emptyRecords;
  const canWriteRecords =
    currentUser?.role !== "viewer" &&
    selectedBackend?.capabilities.includes("writeRecords") === true;
  const adminBackends = adminBackendsQuery.data?.items ?? emptyBackends;
  const adminUsers = adminUsersQuery.data?.items ?? emptyAdminUsers;
  const adminIdentityProviders =
    adminIdentityProvidersQuery.data?.items ?? emptyIdentityProviders;
  const auditEvents = auditEventsQuery.data?.items ?? emptyAuditEvents;
  const effectiveGrantZoneName = activeZoneName ?? selectedGrantZoneName;

  useEffect(() => {
    if (!isAuthenticated || typeof window === "undefined") {
      return;
    }

    if (window.location.hash.trim().length === 0) {
      navigate({ kind: "zones" });
    }
  }, [isAuthenticated]);

  useEffect(() => {
    setSelectedRecordKeys([]);
    setRecordSearch("");
    setTypeFilter("ALL");
    setSortKey("name");
    setSortDirection("asc");
    setPage(1);
  }, [activeZoneName]);

  useEffect(() => {
    if (adminUsers.length === 0) {
      return;
    }

    const preferredGrantUser =
      adminUsers.find(
        (user) => user.username !== currentUser?.username && user.role !== "admin",
      ) ??
      adminUsers.find((user) => user.role !== "admin") ??
      adminUsers[0];

    if (
      selectedGrantUsername === null ||
      !adminUsers.some((user) => user.username === selectedGrantUsername)
    ) {
      setSelectedGrantUsername(preferredGrantUser?.username ?? null);
    }
  }, [adminUsers, currentUser?.username, selectedGrantUsername]);

  useEffect(() => {
    const selectedUser = adminUsers.find((user) => user.username === selectedGrantUsername);
    if (selectedUser) {
      setSelectedUserRole(selectedUser.role);
    }
  }, [adminUsers, selectedGrantUsername]);

  useEffect(() => {
    if (editingBackendName !== null || isCreatingBackend || adminBackends.length === 0) {
      return;
    }

    const firstBackend = adminBackends[0];
    setEditingBackendName(firstBackend.name);
    setBackendName(firstBackend.name);
    setBackendType(firstBackend.backendType);
    setBackendCapabilities(firstBackend.capabilities.join(", "));
  }, [adminBackends, editingBackendName, isCreatingBackend]);

  useEffect(() => {
    if (
      editingProviderName !== null ||
      isCreatingProvider ||
      adminIdentityProviders.length === 0
    ) {
      return;
    }

    const firstProvider = adminIdentityProviders[0];
    setEditingProviderName(firstProvider.name);
    setProviderName(firstProvider.name);
    setProviderIssuer(firstProvider.issuer);
    setProviderClientId(firstProvider.clientId);
    setProviderClientSecret("");
    setProviderScopes(firstProvider.scopes.join(", "));
    setProviderClaimsRules(JSON.stringify(firstProvider.claimsMappingRules, null, 2));
    setProviderFormError(null);
  }, [adminIdentityProviders, editingProviderName, isCreatingProvider]);

  useEffect(() => {
    if (activeZoneName) {
      setSelectedGrantZoneName(activeZoneName);
      return;
    }

    if (zones.length === 0) {
      return;
    }

    if (
      selectedGrantZoneName === null ||
      !zones.some((zone) => zone.name === selectedGrantZoneName)
    ) {
      setSelectedGrantZoneName(zones[0]?.name ?? null);
    }
  }, [activeZoneName, selectedGrantZoneName, zones]);

  useEffect(() => {
    if (discoverableBackends.length === 0) {
      if (discoveryBackendName.length > 0) {
        setDiscoveryBackendName("");
      }
      return;
    }

    if (
      discoveryBackendName.length === 0 ||
      !discoverableBackends.some((backend) => backend.name === discoveryBackendName)
    ) {
      setDiscoveryBackendName(discoverableBackends[0]?.name ?? "");
    }
  }, [discoverableBackends, discoveryBackendName]);

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loginMutation.mutateAsync({ username, password });
  }

  async function handleOidcLogin(providerName: string) {
    await oidcLoginMutation.mutateAsync({
      providerName,
      returnTo: window.location.href,
    });
  }

  async function handleRecordPreview(submission: RecordEditorSubmission) {
    const change = await previewMutation.mutateAsync({
      operation: submission.operation,
      zoneName: submission.zoneName,
      name: submission.name,
      recordType: submission.recordType,
      ttl: submission.ttl,
      values: submission.values,
      expectedVersion: submission.expectedVersion,
    });
    setEditorState(null);
    setPreviewState({
      kind: "single",
      title:
        submission.operation === "create"
          ? "Preview new record"
          : "Preview record update",
      confirmLabel:
        submission.operation === "create" ? "Apply create" : "Apply update",
      change,
      submission,
    });
  }

  async function handleDeletePreview(record: RecordSet) {
    const change = await previewMutation.mutateAsync({
      operation: "delete",
      zoneName: record.zoneName,
      name: record.name,
      recordType: record.recordType,
      expectedVersion: record.version,
    });
    setPreviewState({
      kind: "single",
      title: `Preview delete for ${record.name} ${record.recordType}`,
      confirmLabel: "Apply delete",
      change,
      submission: {
        operation: "delete",
        zoneName: record.zoneName,
        name: record.name,
        recordType: record.recordType,
        expectedVersion: record.version,
      },
    });
  }

  function handleBulkDeletePreview() {
    if (activeZoneName === null) {
      return;
    }

    const selectedRecords = records.filter((record) =>
      selectedRecordKeys.includes(getRecordKey(record)),
    );
    if (selectedRecords.length === 0) {
      return;
    }

    setPreviewState({
      kind: "bulk-delete",
      title: `Preview bulk delete (${selectedRecords.length})`,
      confirmLabel: "Apply bulk delete",
      zoneName: activeZoneName,
      records: selectedRecords,
      items: selectedRecords.map((record) => ({
        operation: "delete",
        name: record.name,
        recordType: record.recordType,
        expectedVersion: record.version,
      })),
    });
  }

  async function handleConfirmPreview() {
    if (!previewState) {
      return;
    }

    if (previewState.kind === "single") {
      if (previewState.submission.operation === "create") {
        await createRecordMutation.mutateAsync({
          zoneName: previewState.submission.zoneName,
          name: previewState.submission.name,
          recordType: previewState.submission.recordType,
          ttl: previewState.submission.ttl,
          values: previewState.submission.values,
        });
      } else if (previewState.submission.operation === "update") {
        await updateRecordMutation.mutateAsync({
          zoneName: previewState.submission.zoneName,
          name: previewState.submission.name,
          recordType: previewState.submission.recordType,
          ttl: previewState.submission.ttl,
          values: previewState.submission.values,
          expectedVersion: previewState.submission.expectedVersion ?? "",
        });
      } else {
        await deleteRecordMutation.mutateAsync({
          zoneName: previewState.submission.zoneName,
          name: previewState.submission.name,
          recordType: previewState.submission.recordType,
          expectedVersion: previewState.submission.expectedVersion!,
        });
      }
    } else {
      await bulkChangeMutation.mutateAsync({
        zoneName: previewState.zoneName,
        items: previewState.items,
      });
    }

    setPreviewState(null);
  }

  function handleRecordSelection(recordKey: string) {
    setSelectedRecordKeys((current) =>
      current.includes(recordKey)
        ? current.filter((item) => item !== recordKey)
        : [...current, recordKey],
    );
  }

  function handleSortChange(nextSortKey: SortKey) {
    setSortDirection((current) =>
      sortKey === nextSortKey ? (current === "asc" ? "desc" : "asc") : "asc",
    );
    setSortKey(nextSortKey);
  }

  function toggleGrantAction(action: string) {
    setGrantActions((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    );
  }

  function resetBackendForm() {
    if (editingBackendName) {
      const existingBackend = adminBackends.find((backend) => backend.name === editingBackendName);
      if (existingBackend) {
        setBackendName(existingBackend.name);
        setBackendType(existingBackend.backendType);
        setBackendCapabilities(existingBackend.capabilities.join(", "));
        setIsCreatingBackend(false);
        return;
      }
    }

    setEditingBackendName(null);
    setBackendName("");
    setBackendType("powerdns");
    setBackendCapabilities("readZones, readRecords, writeRecords");
  }

  function resetProviderForm() {
    if (editingProviderName) {
      const existingProvider = adminIdentityProviders.find(
        (provider) => provider.name === editingProviderName,
      );
      if (existingProvider) {
        setProviderName(existingProvider.name);
        setProviderIssuer(existingProvider.issuer);
        setProviderClientId(existingProvider.clientId);
        setProviderClientSecret("");
        setProviderScopes(existingProvider.scopes.join(", "));
        setProviderClaimsRules(JSON.stringify(existingProvider.claimsMappingRules, null, 2));
        setProviderFormError(null);
        setIsCreatingProvider(false);
        return;
      }
    }

    setEditingProviderName(null);
    setProviderName("");
    setProviderIssuer("https://issuer.example");
    setProviderClientId("zonix-ui");
    setProviderClientSecret("");
    setProviderScopes("openid, profile, email");
    setProviderClaimsRules(
      '{\n  "usernameClaim": "preferred_username",\n  "rolesClaim": "groups"\n}',
    );
    setProviderFormError(null);
  }

  function beginBackendCreate() {
    setIsCreatingBackend(true);
    setEditingBackendName(null);
    setBackendName("");
    setBackendType("powerdns");
    setBackendCapabilities("readZones, readRecords, writeRecords");
  }

  function beginProviderCreate() {
    setIsCreatingProvider(true);
    setEditingProviderName(null);
    setProviderName("");
    setProviderIssuer("https://issuer.example");
    setProviderClientId("zonix-ui");
    setProviderClientSecret("");
    setProviderScopes("openid, profile, email");
    setProviderClaimsRules(
      '{\n  "usernameClaim": "preferred_username",\n  "rolesClaim": "groups"\n}',
    );
    setProviderFormError(null);
  }

  async function handleBackendSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createBackendMutation.mutateAsync({
      name: backendName.trim(),
      backendType: backendType.trim(),
      capabilities: normalizeCommaSeparatedList(backendCapabilities),
    });
  }

  async function handleIdentityProviderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let claimsMappingRules: Record<string, unknown> = {};
    try {
      claimsMappingRules = JSON.parse(providerClaimsRules) as Record<string, unknown>;
    } catch {
      setProviderFormError(
        locale === "ru"
          ? "Правила маппинга claims должны быть валидным JSON."
          : "Claims mapping rules must be valid JSON.",
      );
      return;
    }

    setProviderFormError(null);
    await createIdentityProviderMutation.mutateAsync({
      name: providerName.trim(),
      kind: "oidc",
      issuer: providerIssuer.trim(),
      clientId: providerClientId.trim(),
      clientSecret: providerClientSecret.trim() || undefined,
      scopes: normalizeCommaSeparatedList(providerScopes),
      claimsMappingRules,
    });
  }

  async function handleGrantSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGrantUsername || !effectiveGrantZoneName) {
      return;
    }
    await assignGrantMutation.mutateAsync({
      username: selectedGrantUsername,
      zoneName: effectiveGrantZoneName,
      actions: grantActions,
    });
  }

  const deferredZoneSearch = useDeferredValue(zoneSearch);
  const filteredZones = zones.filter((zone) => {
    const needle = deferredZoneSearch.trim().toLowerCase();
    if (needle.length === 0) {
      return true;
    }
    return (
      zone.name.toLowerCase().includes(needle) ||
      zone.backendName.toLowerCase().includes(needle)
    );
  });
  const filteredAuditEvents = auditEvents.filter((event) => {
    const searchNeedle = auditSearch.trim().toLowerCase();
    const matchesSearch =
      searchNeedle.length === 0 ||
      event.actor.toLowerCase().includes(searchNeedle) ||
      event.action.toLowerCase().includes(searchNeedle) ||
      (event.zoneName ?? "").toLowerCase().includes(searchNeedle) ||
      (event.backendName ?? "").toLowerCase().includes(searchNeedle) ||
      formatPayload(event.payload, locale).toLowerCase().includes(searchNeedle);
    const matchesActor =
      auditActorFilter === "ALL" || event.actor === auditActorFilter;
    const matchesZone = auditZoneFilter === "ALL" || event.zoneName === auditZoneFilter;
    return matchesSearch && matchesActor && matchesZone;
  });
  const filteredRecords = records.filter((record) => {
    const matchesType =
      typeFilter === "ALL" ? true : record.recordType === typeFilter;
    const needle = deferredRecordSearch.trim().toLowerCase();
    const matchesSearch =
      needle.length === 0 ||
      record.name.toLowerCase().includes(needle) ||
      record.recordType.toLowerCase().includes(needle) ||
      String(record.ttl).includes(needle) ||
      record.values.some((value) => value.toLowerCase().includes(needle));
    return matchesType && matchesSearch;
  });
  const sortedRecords = sortRecords(filteredRecords, sortKey, sortDirection);
  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / pageSize));
  const paginatedRecords = sortedRecords.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const selectedUser = adminUsers.find((user) => user.username === selectedGrantUsername);
  const isGrantChangeBlocked = selectedUser?.role === "admin";
  const actingMutationPending =
    previewMutation.isPending ||
    createRecordMutation.isPending ||
    updateRecordMutation.isPending ||
    deleteRecordMutation.isPending ||
    bulkChangeMutation.isPending;

  const sharedAdminConsoleProps = {
    activeSectionLabel: "",
    activeSectionDescription: "",
    adminBackends,
    adminBackendsLoading: adminBackendsQuery.isLoading,
    adminIdentityProviders,
    adminIdentityProvidersLoading: adminIdentityProvidersQuery.isLoading,
    adminUsers,
    adminZoneGrants: adminZoneGrantsQuery.data?.items ?? [],
    adminZoneGrantsLoading: adminZoneGrantsQuery.isLoading,
    assignGrantError: assignGrantMutation.isError,
    assignGrantPending: assignGrantMutation.isPending,
    assignGrantSuccess: assignGrantMutation.isSuccess,
    availableZoneNames: zones.map((zone) => zone.name),
    backendCapabilities,
    backendName,
    backendType,
    createBackendError: createBackendMutation.isError,
    createBackendPending: createBackendMutation.isPending,
    createBackendSuccess: createBackendMutation.isSuccess,
    createIdentityProviderError: createIdentityProviderMutation.isError,
    createIdentityProviderPending: createIdentityProviderMutation.isPending,
    createIdentityProviderSuccess: createIdentityProviderMutation.isSuccess,
    deleteBackendPending: deleteBackendMutation.isPending,
    deleteIdentityProviderPending: deleteIdentityProviderMutation.isPending,
    editingBackendName,
    editingProviderName,
    grantActions,
    locale,
    isBackendFormDirty:
      editingBackendName !== null ||
      isCreatingBackend ||
      backendName.trim().length > 0 ||
      backendType !== "powerdns" ||
      backendCapabilities !== "readZones, readRecords, writeRecords",
    isEditingCurrentUser: selectedGrantUsername === currentUser?.username,
    isGrantChangeBlocked,
    isProviderFormDirty:
      editingProviderName !== null ||
      isCreatingProvider ||
      providerName.trim().length > 0 ||
      providerIssuer !== "https://issuer.example" ||
      providerClientId !== "zonix-ui" ||
      providerClientSecret.trim().length > 0,
    isRoleChangeBlocked: selectedGrantUsername === currentUser?.username,
    onCreateBackend: beginBackendCreate,
    onBackendSubmit: handleBackendSubmit,
    onDeleteBackend: (backendNameToDelete: string) =>
      deleteBackendMutation.mutate(backendNameToDelete),
    onDeleteIdentityProvider: (providerNameToDelete: string) =>
      deleteIdentityProviderMutation.mutate(providerNameToDelete),
    onEditBackend: (backend: Backend) => {
      setIsCreatingBackend(false);
      setEditingBackendName(backend.name);
      setBackendName(backend.name);
      setBackendType(backend.backendType);
      setBackendCapabilities(backend.capabilities.join(", "));
    },
    onEditIdentityProvider: (provider: {
      name: string;
      issuer: string;
      clientId: string;
      scopes: string[];
      hasClientSecret: boolean;
      claimsMappingRules: Record<string, unknown>;
    }) => {
      setIsCreatingProvider(false);
      setEditingProviderName(provider.name);
      setProviderName(provider.name);
      setProviderIssuer(provider.issuer);
      setProviderClientId(provider.clientId);
      setProviderClientSecret("");
      setProviderScopes(provider.scopes.join(", "));
      setProviderClaimsRules(JSON.stringify(provider.claimsMappingRules, null, 2));
      setProviderFormError(null);
    },
    onCreateProvider: beginProviderCreate,
    onGrantSubmit: handleGrantSubmit,
    onIdentityProviderSubmit: handleIdentityProviderSubmit,
    onResetBackendForm: resetBackendForm,
    onResetProviderForm: resetProviderForm,
    onRoleSubmit: () => {
      if (!selectedGrantUsername) {
        return;
      }
      updateUserRoleMutation.mutate({
        username: selectedGrantUsername,
        role: selectedUserRole,
      });
    },
    onSectionChange: (section: AdminSection) => {
      if (section === "access") navigate({ kind: "admin-access" });
      if (section === "backends") navigate({ kind: "admin-backends" });
      if (section === "identity") navigate({ kind: "admin-identity" });
    },
    onSyncBackend: (backendNameToSync: string) =>
      syncBackendMutation.mutate(backendNameToSync),
    providerClaimsRules,
    providerClientId,
    providerClientSecret,
    providerFormError,
    providerIssuer,
    providerName,
    providerScopes,
    selectedAdminUserRole: selectedUser?.role,
    selectedGrantUsername,
    selectedUserRole,
    setBackendCapabilities,
    setBackendName,
    setBackendType,
    setProviderClaimsRules,
    setProviderClientId,
    setProviderClientSecret,
    setProviderIssuer,
    setProviderName,
    setProviderScopes,
    setSelectedGrantUsername,
    setSelectedUserRole,
    setZoneContextName: setSelectedGrantZoneName,
    showHeader: false,
    showSectionHeading: false,
    showTabs: false,
    syncBackendPending: syncBackendMutation.isPending,
    toggleGrantAction,
    updateUserRoleError: updateUserRoleMutation.isError,
    updateUserRolePending: updateUserRoleMutation.isPending,
    updateUserRoleSuccess: updateUserRoleMutation.isSuccess,
    zoneContextName: effectiveGrantZoneName,
  };

  function renderZoneDetailPage() {
    if ((zoneDetailQuery.isLoading && !activeZone) || (zoneRecordsQuery.isLoading && !activeZone)) {
      return (
        <StatePanel
          eyebrow={tr(locale, "Zone detail")}
          message={
            locale === "ru"
              ? "Загружаем метаданные зоны, инвентарь записей и возможности активного бэкенда."
              : "Fetching zone metadata, record inventory, and backend capabilities."
          }
          title={tr(locale, "Loading zone detail")}
          tone="loading"
        />
      );
    }

    if (!activeZone) {
      const message = zoneDetailQuery.isError
        ? getErrorMessage(
            zoneDetailQuery.error,
            locale === "ru"
              ? "Выбранную зону не удалось загрузить из API."
              : "The selected zone could not be loaded from the API.",
          )
        : locale === "ru"
          ? "Выбранная зона больше недоступна в этой сессии."
          : "The selected zone is no longer available for this session.";

      return (
        <StatePanel
          eyebrow={tr(locale, "Zone detail")}
          message={message}
          title={tr(locale, "Zone detail is unavailable")}
          tone="error"
        />
      );
    }

    const sessionAccessCopy =
      currentUser?.role === "viewer"
        ? locale === "ru"
          ? "Сессия наблюдателя. Записи видны, но preview и apply остаются заблокированы."
          : "Viewer session. Records stay visible, but preview/apply actions remain locked."
        : canWriteRecords
          ? locale === "ru"
            ? "Сессия с записью. Для этого бэкенда доступны preview и apply."
            : "Write-enabled session. Preview and apply actions are available for this backend."
          : locale === "ru"
            ? "Этот бэкенд виден только для чтения, поэтому редактирование и удаление отключены."
            : "This backend is visible in read-only mode, so edit and delete actions stay disabled.";
    const selectedBackendCapabilities = selectedBackend?.capabilities ?? [];
    const recordsErrorMessage = zoneRecordsQuery.isError
      ? getErrorMessage(
          zoneRecordsQuery.error,
          locale === "ru"
            ? "Не удалось загрузить инвентарь записей для этой зоны."
            : "Record inventory failed to load for this zone.",
        )
      : null;

    return (
      <section className="page-stack">
        <section className="zone-workspace-hero" data-tour="zone-workspace-hero">
          <div className="zone-workspace-copy">
            <div>
              <p className="section-label">{tr(locale, "Zone detail")}</p>
              <h1>{activeZone.name}</h1>
            </div>
            <div className="zone-workspace-tags">
              <span className="inventory-tag">
                {formatBackendTypeLabel(selectedBackend?.backendType ?? "backend")}
              </span>
              <span className={canWriteRecords ? "inventory-tag inventory-tag-success" : "inventory-tag"}>
                {currentUser?.role === "viewer"
                  ? tr(locale, "read-only session")
                  : getBackendAccessLabel(selectedBackendCapabilities, locale)}
              </span>
            </div>
            <p className="section-copy zone-workspace-copy-text">
              {locale === "ru"
                ? "Просматривайте инвентарь записей, смотрите diff до apply и держите перед глазами контекст возможностей бэкенда прямо внутри этой зоны."
                : "Navigate record inventory, preview changes before apply, and keep backend capability context visible while operating inside this zone."}
            </p>
          </div>
          <div className="page-header-actions zone-workspace-actions">
            {canWriteRecords ? (
              <button
                className="primary-button"
                data-tour="zone-add-record"
                onClick={() => setEditorState({ mode: "create", record: null })}
                type="button"
              >
                {tr(locale, "Add record")}
              </button>
            ) : null}
            {isAdmin && selectedBackend ? (
              <button
                className="secondary-button"
                disabled={syncBackendMutation.isPending}
                onClick={() => syncBackendMutation.mutate(selectedBackend.name)}
                type="button"
              >
                {syncBackendMutation.isPending ? tr(locale, "Syncing…") : tr(locale, "Sync backend")}
              </button>
            ) : null}
          </div>
        </section>

        <div className="summary-grid summary-grid-zone">
          <div className="summary-card summary-card-accent">
            <span>{tr(locale, "Backend")}</span>
            <strong>{activeZone.backendName}</strong>
            <p className="summary-card-copy">
              {formatBackendTypeLabel(selectedBackend?.backendType ?? "backend")}
            </p>
          </div>
          <div className="summary-card">
            <span>{tr(locale, "Visible records")}</span>
            <strong>{records.length}</strong>
            <p className="summary-card-copy">
              {locale === "ru"
                ? "Текущие RRsets, которые сейчас отданы активным бэкендом."
                : "Live RRsets currently loaded from the active backend."}
            </p>
          </div>
          <div className="summary-card">
            <span>{tr(locale, "Access")}</span>
            <strong>
              {canWriteRecords
                ? getBackendAccessLabel(["writeRecords"], locale)
                : tr(locale, "read-only")}
            </strong>
            <p className="summary-card-copy">{sessionAccessCopy}</p>
          </div>
          <div className="summary-card">
            <span>{tr(locale, "Capabilities")}</span>
            <div className="capability-list">
              {selectedBackendCapabilities.map((capability) => (
                <CapabilityBadge key={capability} capability={capability} locale={locale} />
              ))}
            </div>
          </div>
        </div>

        <section className="panel panel-surface">
          <div className="records-surface-head">
            <div className="page-header">
              <div>
                <p className="panel-label">{tr(locale, "Records")}</p>
                <h2>{tr(locale, "Record table")}</h2>
              </div>
              <span className="panel-meta">
                {locale === "ru"
                  ? `Показано ${sortedRecords.length} из ${records.length}`
                  : `${sortedRecords.length} shown of ${records.length}`}
              </span>
            </div>

            <div className="records-toolbar-shell" data-tour="zone-record-table">
              <div className="records-toolbar">
                <input
                  aria-label={tr(locale, "Search records")}
                  className="records-search"
                  onChange={(event) => setRecordSearch(event.target.value)}
                  placeholder={tr(locale, "Search by name, type, ttl, or value…")}
                  value={recordSearch}
                />
                <select
                  aria-label={locale === "ru" ? "Фильтр по типу" : "Filter by type"}
                  onChange={(event) => setTypeFilter(event.target.value as "ALL" | RecordType)}
                  value={typeFilter}
                >
                  <option value="ALL">{tr(locale, "All types")}</option>
                  {recordTypeOptions.map((recordType) => (
                    <option key={recordType} value={recordType}>
                      {recordType}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={locale === "ru" ? "Размер страницы" : "Page size"}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  value={String(pageSize)}
                >
                  <option value="10">10 {tr(locale, "rows")}</option>
                  <option value="25">25 {tr(locale, "rows")}</option>
                  <option value="50">50 {tr(locale, "rows")}</option>
                </select>
                <button className="secondary-button" onClick={() => handleSortChange("name")} type="button">
                  {tr(locale, "Name")} {sortKey === "name" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                </button>
                <button className="secondary-button" onClick={() => handleSortChange("type")} type="button">
                  {tr(locale, "Type")} {sortKey === "type" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                </button>
                <button className="secondary-button" onClick={() => handleSortChange("ttl")} type="button">
                  TTL {sortKey === "ttl" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                </button>
              </div>

              <div className="records-meta-row">
                <div className="records-meta-group">
                  <span>
                    {locale === "ru"
                      ? `Выбрано: ${selectedRecordKeys.length}`
                      : `${selectedRecordKeys.length} selected`}
                  </span>
                  <span>{locale === "ru" ? `${totalPages} стр.` : `${totalPages} pages`}</span>
                </div>
                <div className="records-meta-group">
                  {!canWriteRecords ? (
                    <span className="inventory-tag">{tr(locale, "Read-only")}</span>
                  ) : selectedRecordKeys.length > 0 ? (
                    <button
                      className="secondary-button secondary-button-danger"
                      onClick={handleBulkDeletePreview}
                      type="button"
                    >
                      {locale === "ru"
                        ? `Предпросмотр массового удаления (${selectedRecordKeys.length})`
                        : `Preview bulk delete (${selectedRecordKeys.length})`}
                    </button>
                  ) : (
                    <span className="helper-copy">
                      {locale === "ru"
                        ? "Выберите одну или несколько RRsets, чтобы подготовить массовое удаление."
                        : "Select one or more RRsets to bulk-delete."}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {recordsErrorMessage ? (
            <StatePanel
              eyebrow={tr(locale, "Record table")}
              message={recordsErrorMessage}
              title={locale === "ru" ? "Таблица записей недоступна" : "Record table is unavailable"}
              tone="error"
            />
          ) : paginatedRecords.length === 0 ? (
            records.length === 0 ? (
              <StatePanel
                eyebrow={tr(locale, "Record table")}
                message={
                  canWriteRecords
                    ? locale === "ru"
                      ? "Зона управляется, но RRsets пока нет. Начните с создания первой записи."
                      : "This zone is managed, but no RRsets exist yet. Start by creating the first record."
                    : locale === "ru"
                      ? "Зона управляется, но текущий бэкенд ещё не отдал ни одной RRset."
                      : "This zone is managed, but the current backend has not surfaced any RRsets yet."
                }
                title={tr(locale, "No records are present")}
              />
            ) : (
              <StatePanel
                action={
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setRecordSearch("");
                      setTypeFilter("ALL");
                    }}
                    type="button"
                  >
                    {tr(locale, "Clear filters")}
                  </button>
                }
                eyebrow={tr(locale, "Record table")}
                message={
                  locale === "ru"
                    ? "Сбросьте поиск или фильтр по типу, чтобы расширить видимый набор записей."
                    : "Clear the search or reset the type filter to widen the visible record set."
                }
                title={tr(locale, "No records match the current filters")}
              />
            )
          ) : (
            <div className="records-table">
              <div className="records-header">
                <span>{tr(locale, "Select")}</span>
                <span>{tr(locale, "Name")}</span>
                <span>{tr(locale, "Type")}</span>
                <span>TTL</span>
                <span>{tr(locale, "Value")}</span>
                <span>{tr(locale, "Actions")}</span>
              </div>
              {paginatedRecords.map((record) => {
                const recordKey = getRecordKey(record);
                const isSelected = selectedRecordKeys.includes(recordKey);
                return (
                  <div
                    key={recordKey}
                    className={isSelected ? "records-row records-row-selected" : "records-row"}
                  >
                    <div className="records-cell" data-label={tr(locale, "Select")}>
                      <input
                        aria-label={
                          locale === "ru"
                            ? `Выбрать ${record.name} ${record.recordType}`
                            : `Select ${record.name} ${record.recordType}`
                        }
                        checked={isSelected}
                        disabled={!canWriteRecords}
                        onChange={() => handleRecordSelection(recordKey)}
                        type="checkbox"
                      />
                    </div>
                    <div className="records-cell" data-label={tr(locale, "Name")}>
                      <div className="record-name-stack">
                        <strong>{record.name}</strong>
                        <span>{activeZone.name}</span>
                      </div>
                    </div>
                    <div className="records-cell" data-label={tr(locale, "Type")}>
                      <span className="record-type-pill">{record.recordType}</span>
                    </div>
                    <div className="records-cell" data-label="TTL">
                      <span className="record-ttl-value">{record.ttl}</span>
                    </div>
                    <div className="records-cell records-cell-value" data-label={tr(locale, "Value")}>
                      <code>{record.values.join("\n")}</code>
                    </div>
                    <div className="records-cell records-cell-actions" data-label={tr(locale, "Actions")}>
                      <div className="row-actions">
                        {canWriteRecords ? (
                          <>
                            <button
                              className="secondary-button"
                              onClick={() => setEditorState({ mode: "update", record })}
                              type="button"
                            >
                              {tr(locale, "Edit")}
                            </button>
                            <button
                              className="secondary-button secondary-button-danger"
                              onClick={() => void handleDeletePreview(record)}
                              type="button"
                            >
                              {tr(locale, "Delete")}
                            </button>
                          </>
                        ) : (
                          <span className="inventory-tag">{tr(locale, "Read-only")}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 ? (
            <div className="pagination-row">
              <button
                className="secondary-button"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                {tr(locale, "Previous")}
              </button>
              <span>
                {locale === "ru" ? `Страница ${page} из ${totalPages}` : `Page ${page} of ${totalPages}`}
              </span>
              <button
                className="secondary-button"
                disabled={page === totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                type="button"
              >
                {tr(locale, "Next")}
              </button>
            </div>
          ) : null}
        </section>
      </section>
    );
  }

  function renderBackendsPage() {
    const backendZoneCount = new Map<string, number>();
    for (const zone of zones) {
      backendZoneCount.set(zone.backendName, (backendZoneCount.get(zone.backendName) ?? 0) + 1);
    }

    return (
      <section className="page-stack">
        <section className="inventory-hero inventory-hero-backends">
          <div className="inventory-hero-copy">
            <p className="section-label">{locale === "ru" ? "Бэкенды" : "Backends"}</p>
            <h1>{locale === "ru" ? "Инвентарь бэкендов" : "Backend inventory"}</h1>
            <p className="section-copy">
              {locale === "ru"
                ? "С первого взгляда читайте операционный профиль каждого DNS-бэкенда: что он умеет, сколько управляемых зон стоит за ним и может ли текущая сессия писать изменения."
                : "Read the operational shape of each DNS backend at a glance: what it can do, how many managed zones sit behind it, and whether this session can push writes."}
            </p>
          </div>
          <div className="inventory-hero-aside">
            <div className="inventory-stat-card">
              <span>{locale === "ru" ? "Видимые бэкенды" : "Visible backends"}</span>
              <strong>{visibleBackends.length}</strong>
            </div>
            <div className="inventory-stat-card">
              <span>{locale === "ru" ? "Управляемые зоны" : "Managed zones"}</span>
              <strong>{zones.length}</strong>
            </div>
            <div className="inventory-stat-card">
              <span>{locale === "ru" ? "С записью" : "Write-capable"}</span>
              <strong>
                {visibleBackends.filter((backend) => backend.capabilities.includes("writeRecords")).length}
              </strong>
            </div>
            <div className="inventory-stat-card">
              <span>{locale === "ru" ? "С обнаружением" : "Discovery-enabled"}</span>
              <strong>
                {visibleBackends.filter((backend) => backend.capabilities.includes("discoverZones")).length}
              </strong>
            </div>
          </div>
        </section>

        {backendsQuery.isLoading || (isAdmin && adminBackendsQuery.isLoading) ? (
          <StatePanel
            eyebrow={locale === "ru" ? "Инвентарь" : "Inventory"}
            message={
              locale === "ru"
                ? "Обновляем возможности бэкендов, количество зон и доступные действия синхронизации."
                : "Refreshing backend capabilities, zone ownership counts, and sync affordances."
            }
            title={locale === "ru" ? "Загрузка бэкендов" : "Loading backends"}
            tone="loading"
          />
        ) : backendsQuery.isError || (isAdmin && adminBackendsQuery.isError) ? (
          <StatePanel
            eyebrow={locale === "ru" ? "Инвентарь" : "Inventory"}
            message={getErrorMessage(
              adminBackendsQuery.error ?? backendsQuery.error,
              locale === "ru"
                ? "Не удалось загрузить инвентарь бэкендов для текущей сессии."
                : "Backend inventory could not be loaded for this session.",
            )}
            title={locale === "ru" ? "Инвентарь бэкендов недоступен" : "Backend inventory is unavailable"}
            tone="error"
          />
        ) : visibleBackends.length === 0 ? (
          <StatePanel
            eyebrow={locale === "ru" ? "Инвентарь" : "Inventory"}
            message={
              locale === "ru"
                ? "Сначала зарегистрируйте конфиг бэкенда, а уже потом синхронизируйте или открывайте зоны."
                : "Register a backend configuration before syncing or browsing zones."
            }
            title={locale === "ru" ? "Бэкенды не зарегистрированы" : "No backends are registered"}
          />
        ) : (
          <div className="backend-grid">
            {visibleBackends.map((backend, index) => (
              <article
                key={backend.name}
                className="backend-card"
                data-tour={index === 0 ? "backend-primary-card" : undefined}
              >
                <div className="backend-card-topline">
                  <span className="backend-card-kicker">
                    {formatBackendTypeLabel(backend.backendType)}
                  </span>
                  <span className="backend-card-summary">
                    {summarizeCapabilities(backend.capabilities, locale)}
                  </span>
                </div>
                <div className="backend-card-heading">
                  <strong>{backend.name}</strong>
                  <span>
                    {locale === "ru"
                      ? `${backendZoneCount.get(backend.name) ?? 0} управляемых зон`
                      : `${backendZoneCount.get(backend.name) ?? 0} managed zone(s)`}
                  </span>
                </div>
                <div className="backend-card-metrics">
                  <div>
                    <span>{locale === "ru" ? "Доступ к записям" : "Record access"}</span>
                    <strong>{getBackendAccessLabel(backend.capabilities, locale)}</strong>
                  </div>
                  <div>
                    <span>{locale === "ru" ? "Обнаружение" : "Discovery"}</span>
                    <strong>
                      {backend.capabilities.includes("discoverZones")
                        ? locale === "ru"
                          ? "Включено"
                          : "Enabled"
                        : locale === "ru"
                          ? "Вручную"
                          : "Manual"}
                    </strong>
                  </div>
                  <div>
                    <span>{locale === "ru" ? "Операторский режим" : "Operator UX"}</span>
                    <strong>
                      {isAdmin
                        ? locale === "ru"
                          ? "Инвентарь + синхронизация"
                          : "Inventory + sync"
                        : locale === "ru"
                          ? "Только инвентарь"
                          : "Inventory only"}
                    </strong>
                  </div>
                </div>
                <div className="capability-list">
                  {backend.capabilities.map((capability) => (
                    <CapabilityBadge key={capability} capability={capability} locale={locale} />
                  ))}
                </div>
                <p className="backend-card-copy">
                  {backend.capabilities.includes("discoverZones")
                    ? locale === "ru"
                      ? "Этот бэкенд может обновлять инвентарь зон напрямую из upstream-источника."
                      : "This backend can refresh zone inventory directly from the upstream source."
                    : locale === "ru"
                      ? "Этот бэкенд остаётся видимым в инвентаре, но регистрация зон ведётся отдельно."
                      : "This backend stays visible in inventory, but zone registration is managed separately."}
                </p>
                <div className="backend-card-footer">
                  <span className="backend-card-zone-summary">
                    {zones
                      .filter((zone) => zone.backendName === backend.name)
                      .slice(0, 2)
                      .map((zone) => zone.name)
                      .join(" · ") ||
                      (locale === "ru" ? "Нет управляемых зон в текущем контуре" : "No managed zones in scope")}
                  </span>
                  {isAdmin && backend.capabilities.includes("discoverZones") ? (
                    <button
                      className="secondary-button"
                      disabled={syncBackendMutation.isPending}
                      onClick={() => syncBackendMutation.mutate(backend.name)}
                      type="button"
                    >
                      {syncBackendMutation.isPending
                        ? locale === "ru"
                          ? "Синхронизация…"
                          : "Syncing…"
                        : locale === "ru"
                          ? "Синхронизировать зоны"
                          : "Sync zones"}
                    </button>
                  ) : (
                    <span className="inventory-tag">
                      {isAdmin
                        ? locale === "ru"
                          ? "Ручная регистрация"
                          : "Manual registration"
                        : locale === "ru"
                          ? "Только инвентарь"
                          : "Inventory only"}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderAuditPage() {
    const actorOptions = Array.from(new Set(auditEvents.map((event) => event.actor)));
    const zoneOptions = Array.from(
      new Set(
        auditEvents
          .map((event) => event.zoneName)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    );

    return (
      <section className="page-stack">
        <div className="page-header page-header-stack">
          <div>
            <p className="section-label">{tr(locale, "Audit")}</p>
            <h1>{tr(locale, "Audit log")}</h1>
          </div>
          <p className="section-copy">
            {tr(
              locale,
              "Filter who did what, when, and against which zone or backend without dropping to SQL.",
            )}{" "}
            {tr(locale, "Showing the latest 250 events for this session.")}
          </p>
        </div>

        <section className="panel audit-panel">
          <div className="audit-toolbar" data-tour="audit-filters">
            <input
              aria-label={tr(locale, "Search audit events")}
              onChange={(event) => setAuditSearch(event.target.value)}
              placeholder={locale === "ru" ? "Поиск по актору, действию, зоне, бэкенду или данным" : "Search actor, action, zone, backend, or payload"}
              value={auditSearch}
            />
            <select
              aria-label={tr(locale, "Filter audit by actor")}
              onChange={(event) => setAuditActorFilter(event.target.value)}
              value={auditActorFilter}
            >
              <option value="ALL">{tr(locale, "All actors")}</option>
              {actorOptions.map((actor) => (
                <option key={actor} value={actor}>
                  {actor}
                </option>
              ))}
            </select>
            <select
              aria-label={tr(locale, "Filter audit by zone")}
              onChange={(event) => setAuditZoneFilter(event.target.value)}
              value={auditZoneFilter}
            >
              <option value="ALL">{tr(locale, "All zones")}</option>
              {zoneOptions.map((zoneName) => (
                <option key={zoneName} value={zoneName}>
                  {zoneName}
                </option>
              ))}
            </select>
          </div>

          {auditEventsQuery.isLoading ? (
            <StatePanel
              eyebrow={tr(locale, "Audit")}
              message={tr(locale, "Fetching the latest operator actions and shaping the feed for this session.")}
              title={tr(locale, "Loading audit events")}
              tone="loading"
            />
          ) : null}

          {auditEventsQuery.isError ? (
            <StatePanel
              eyebrow={tr(locale, "Audit")}
              message={getErrorMessage(
                auditEventsQuery.error,
                tr(locale, "The backend rejected the audit query for this session."),
              )}
              title={tr(locale, "Audit listing failed")}
              tone="error"
            />
          ) : null}

          {!auditEventsQuery.isLoading &&
          !auditEventsQuery.isError &&
          filteredAuditEvents.length === 0 ? (
            auditEvents.length === 0 ? (
              <StatePanel
                eyebrow={tr(locale, "Audit")}
                message={tr(locale, "Operator actions will appear here once sessions start authenticating and mutating zones.")}
                title={tr(locale, "Audit history is empty")}
              />
            ) : (
              <StatePanel
                action={
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setAuditSearch("");
                      setAuditActorFilter("ALL");
                      setAuditZoneFilter("ALL");
                    }}
                    type="button"
                  >
                    {tr(locale, "Clear filters")}
                  </button>
                }
                eyebrow={tr(locale, "Audit")}
                message={tr(locale, "Widen the search or clear the actor and zone filters to inspect more history.")}
                title={tr(locale, "No audit events match the current filters")}
              />
            )
          ) : null}

          <div className="audit-list">
            {filteredAuditEvents.map((event) => {
              const authSource = getAuditAuthSource(event);
              return (
                <article key={`${event.createdAt}-${event.actor}-${event.action}`} className="audit-card">
                  <div className="audit-card-header">
                    <div className="audit-card-header-copy">
                      <strong title={event.action}>{humanizeAuditAction(event.action, locale)}</strong>
                      <div className="audit-card-tags">
                        {authSource ? (
                          <span className="audit-chip audit-chip-auth">
                            {formatAuditAuthSource(authSource, locale)}
                          </span>
                        ) : null}
                        {event.action.startsWith("login.") || event.action.startsWith("logout.") ? (
                          <span className="audit-chip audit-chip-session">
                            {locale === "ru" ? "Сессия" : "Session"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span>{formatTime(event.createdAt)}</span>
                  </div>
                  <div className="audit-meta-row">
                    <span>{tr(locale, "Actor")}: {event.actor}</span>
                    <span>{tr(locale, "Zone label")}: {event.zoneName ?? "—"}</span>
                    <span>{tr(locale, "Backend label")}: {event.backendName ?? "—"}</span>
                  </div>
                  <div className="audit-payload-list">
                    {getPayloadEntries(event.payload, locale).map(([key, value]) => (
                      <div key={key} className="audit-payload-item">
                        <span>{tr(locale, "Payload")} · {key}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    );
  }

  function renderAdminAccessPage() {
    return (
      <section className="page-stack">
        <div className="page-header page-header-stack">
          <div>
            <p className="section-label">{locale === "ru" ? "Доступ" : "Access"}</p>
            <h1>{tr(locale, "Users, roles, and zone grants")}</h1>
          </div>
          <p className="section-copy">
            {locale === "ru"
              ? "Выберите оператора, проверьте источник входа и затем настройте глобальную роль и доступ к зонам из одной рабочей области."
              : "Pick an operator, confirm their auth source, then adjust role and zone access from one workspace."}
          </p>
        </div>

        {!isAdmin ? (
          <div className="empty-state">
            <strong>{tr(locale, "Admin only")}</strong>
            <p>{locale === "ru" ? "Только админские сессии могут управлять глобальными ролями и правами." : "Only admin sessions can manage global roles and grants."}</p>
          </div>
        ) : (
          <>
            <div className="admin-access-layout">
              <section className="panel admin-access-directory">
                <div className="panel-heading">
                  <div>
                    <p className="panel-label">{tr(locale, "Users")}</p>
                    <h2>{tr(locale, "Directory")}</h2>
                  </div>
                  <span className="panel-meta">
                    {locale === "ru" ? `${adminUsers.length} пользователей` : `${adminUsers.length} users`}
                  </span>
                </div>
                <div className="user-selector-list">
                  {adminUsers.map((user) => (
                    <button
                      key={user.username}
                      className={
                        selectedGrantUsername === user.username
                          ? "user-selector-card user-selector-card-active"
                          : "user-selector-card"
                      }
                      onClick={() => setSelectedGrantUsername(user.username)}
                      type="button"
                    >
                      <div className="user-selector-card-top">
                        <div className="user-selector-card-title">
                          <span className="user-selector-avatar">{getUserInitials(user.username)}</span>
                          <strong>{user.username}</strong>
                        </div>
                        <span className="user-role-badge">{roleLabel(locale, user.role)}</span>
                      </div>
                      <div className="user-selector-card-meta">
                        <span>{user.authSource}</span>
                        <span
                          className={
                            user.isActive
                              ? "status-pill status-pill-success"
                              : "status-pill"
                          }
                        >
                          {user.isActive
                            ? locale === "ru"
                              ? "активна"
                              : "active"
                            : locale === "ru"
                              ? "не активна"
                              : "inactive"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel admin-access-detail" data-tour="admin-access-workspace">
                <div className="panel-heading">
                  <div>
                    <p className="panel-label">{tr(locale, "Manage")}</p>
                    <h2>{tr(locale, "Selected user")}</h2>
                  </div>
                  <span className="panel-meta">
                    {selectedGrantUsername ?? (locale === "ru" ? "никто не выбран" : "none")}
                  </span>
                </div>
                {selectedUser ? (
                  <div className="admin-access-context-strip">
                    <strong>{selectedUser.username}</strong>
                    <span>{selectedUser.authSource}</span>
                    <span className="user-role-badge">{roleLabel(locale, selectedUser.role)}</span>
                    <span
                      className={
                        selectedUser.isActive
                          ? "status-pill status-pill-success"
                          : "status-pill"
                      }
                    >
                      {selectedUser.isActive
                        ? locale === "ru"
                          ? "активна"
                          : "active"
                        : locale === "ru"
                          ? "не активна"
                          : "inactive"}
                    </span>
                  </div>
                ) : null}
                {selectedUser ? (
                  <div className="admin-access-hero">
                    <div className="admin-access-hero-copy">
                      <strong>{tr(locale, "Access workflow")}</strong>
                      <p>
                        {locale === "ru"
                          ? "Сначала задайте глобальную роль, затем сузьте права по зоне только там, где оператору это действительно нужно."
                          : "Set the global role first, then narrow zone access only where the operator needs it."}
                      </p>
                    </div>
                    <div className="admin-access-hero-meta">
                      <span className="user-role-badge">{roleLabel(locale, selectedUser.role)}</span>
                      <span
                        className={
                          selectedUser.isActive
                            ? "status-pill status-pill-success"
                            : "status-pill"
                        }
                      >
                        {selectedUser.isActive
                          ? locale === "ru"
                            ? "активна"
                            : "active"
                          : locale === "ru"
                            ? "не активна"
                            : "inactive"}
                      </span>
                    </div>
                  </div>
                ) : null}
                <AdminConsole
                  {...sharedAdminConsoleProps}
                  activeSection="access"
                  activeSectionDescription={adminSectionMeta.access.description}
                  activeSectionLabel={adminSectionMeta.access.label}
                  showHeader={false}
                  showSectionHeading={false}
                  showTabs={false}
                />
              </section>
            </div>
          </>
        )}
      </section>
    );
  }

  function renderAdminBackendsPage() {
    const manualOnlyBackends = visibleBackends.length - discoverableBackends.length;
    const managedZonesCount = zones.length;

    return (
      <section className="page-stack">
        <div className="page-header page-header-stack">
          <div>
            <p className="section-label">{tr(locale, "Backends")}</p>
            <h1>{tr(locale, "Backend config")}</h1>
          </div>
          <p className="section-copy">
            {locale === "ru"
              ? "Регистрируйте адаптеры, проверяйте возможности и запускайте обнаружение из одного операторского рабочего пространства."
              : "Register adapters, inspect capabilities, and run discovery from one operational workspace."}
          </p>
        </div>

        <section className="admin-summary-strip">
          <div className="admin-summary-copy">
            <p className="section-label">{locale === "ru" ? "Состояние реестра" : "Registry posture"}</p>
            <strong>
              {locale === "ru"
                ? "Держите реестр бэкендов читаемым, а контур обнаружения честным."
                : "Keep backend inventory readable and discovery honest."}
            </strong>
            <p>
              {locale === "ru"
                ? "Показывайте импорт и синхронизацию только там, где адаптер действительно поддерживает обнаружение."
                : "Only expose import and sync paths where the adapter actually supports discovery."}
            </p>
          </div>
          <div className="admin-summary-grid">
            <div className="admin-summary-stat">
              <span>{locale === "ru" ? "Настроено" : "Configured"}</span>
              <strong>{visibleBackends.length}</strong>
            </div>
            <div className="admin-summary-stat">
              <span>{tr(locale, "Discovery-ready")}</span>
              <strong>{discoverableBackends.length}</strong>
            </div>
            <div className="admin-summary-stat">
              <span>{locale === "ru" ? "Только вручную" : "Manual-only"}</span>
              <strong>{manualOnlyBackends}</strong>
            </div>
            <div className="admin-summary-stat">
              <span>{tr(locale, "Managed zones")}</span>
              <strong>{managedZonesCount}</strong>
            </div>
          </div>
        </section>

        {!isAdmin ? (
          <div className="empty-state">
            <strong>{tr(locale, "Admin only")}</strong>
            <p>{locale === "ru" ? "Настройка бэкендов доступна только админским сессиям." : "Backend configuration is restricted to admin sessions."}</p>
          </div>
        ) : (
          <div className="admin-workspace-layout">
            <section className="panel-surface admin-main-surface" data-tour="admin-identity-workspace">
              <div className="panel-heading">
                <div>
                  <p className="panel-label">{tr(locale, "Config")}</p>
                  <h2>{tr(locale, "Backend registry")}</h2>
                </div>
                <span className="panel-meta">
                  {locale === "ru"
                    ? `${discoverableBackends.length} готовы к обнаружению`
                    : `${discoverableBackends.length} ready for discovery`}
                </span>
              </div>
              <p className="helper-copy">
              {locale === "ru"
                  ? "Воспринимайте конфиги бэкендов как операторский реестр: стабильные имена, читаемые типы и явные возможности."
                  : "Treat backend configs like operator inventory: keep names stable, type labels readable, and capabilities explicit."}
              </p>
              <AdminConsole
                {...sharedAdminConsoleProps}
                activeSection="backends"
                activeSectionDescription={adminSectionMeta.backends.description}
                activeSectionLabel={adminSectionMeta.backends.label}
                showHeader={false}
                showSectionHeading={false}
                showTabs={false}
              />
            </section>

            <aside className="admin-side-stack">
              <section className="panel-surface">
                <div className="panel-heading">
                  <div>
                    <p className="panel-label">{tr(locale, "Discovery")}</p>
                    <h2>{tr(locale, "Discover and import zones")}</h2>
                  </div>
                  <span className="panel-meta">
                    {locale === "ru"
                      ? `Найдено: ${lastDiscoveredZones.length}`
                      : `${lastDiscoveredZones.length} discovered`}
                  </span>
                </div>
                <p className="helper-copy">
                  {locale === "ru"
                    ? "Обнаружение доступно только для бэкендов, которые объявляют возможность"
                    : "Discovery is only available on backends that advertise the"}
                  <code> discoverZones </code>
                  {locale === "ru" ? "." : "capability."}
                </p>
                <div className="stacked-form">
                  {discoverableBackends.length === 0 ? (
                    <StatePanel
                      eyebrow={tr(locale, "Discovery")}
                      message={
                        locale === "ru"
                          ? "Сначала зарегистрируйте или включите бэкенд с поддержкой discovery, и уже потом запускайте поиск зон с этого экрана."
                          : "Register or enable a backend with discovery support before running zone discovery from this surface."
                      }
                          title={
                            locale === "ru"
                          ? "Нет бэкендов с поддержкой обнаружения"
                          : "No discovery-capable backends are available"
                      }
                    />
                  ) : (
                    <>
                      <label>
                        <span>{tr(locale, "Backend")}</span>
                        <select
                          aria-label={locale === "ru" ? "Бэкенд для обнаружения" : "Discovery backend"}
                          onChange={(event) => setDiscoveryBackendName(event.target.value)}
                          value={discoveryBackendName}
                        >
                          {discoverableBackends.map((backend) => (
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
                            discoveryBackendName.length === 0 || discoverZonesMutation.isPending
                          }
                          onClick={() => discoverZonesMutation.mutate(discoveryBackendName)}
                          type="button"
                        >
                          {discoverZonesMutation.isPending
                            ? (locale === "ru" ? "Идёт поиск…" : "Discovering…")
                            : (locale === "ru" ? "Найти зоны" : "Discover zones")}
                        </button>
                        <button
                          className="secondary-button"
                          disabled={
                            discoveredZoneNames.length === 0 || importZonesMutation.isPending
                          }
                          onClick={() =>
                            importZonesMutation.mutate({
                              backendName: discoveryBackendName,
                              zoneNames: discoveredZoneNames,
                            })
                          }
                          type="button"
                        >
                          {importZonesMutation.isPending
                            ? (locale === "ru" ? "Импорт…" : "Importing…")
                            : locale === "ru"
                              ? `Импортировать выбранное (${discoveredZoneNames.length})`
                              : `Import selected (${discoveredZoneNames.length})`}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {lastDiscoveredBackendName === discoveryBackendName &&
                lastDiscoveredZones.length > 0 ? (
                  <ul className="resource-list resource-list-compact">
                    {lastDiscoveredZones.map((zone) => {
                      const managed = zones.some((item) => item.name === zone.name);
                      return (
                        <li key={zone.name} className="resource-item-action">
                          <label className="resource-copy checkbox-line">
                            <input
                              checked={discoveredZoneNames.includes(zone.name)}
                              disabled={managed}
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
                              <span>
                                {managed
                                  ? (locale === "ru" ? "уже управляется" : "already managed")
                                  : (locale === "ru" ? "готово к импорту" : "ready to import")}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="placeholder-copy">
                    {locale === "ru"
                      ? "Запустите обнаружение для бэкенда, чтобы просмотреть зоны, готовые к импорту."
                      : "Run discovery against a backend to review importable zones."}
                  </p>
                )}
              </section>

              <section className="panel-surface">
                <div className="panel-heading">
                  <div>
                    <p className="panel-label">{tr(locale, "Guardrails")}</p>
                    <h2>{tr(locale, "Operator rules")}</h2>
                  </div>
                </div>
                <div className="summary-stack">
                  <div className="summary-line">
                    <span>{locale === "ru" ? "Цель обнаружения" : "Discovery target"}</span>
                    <strong>{discoveryBackendName || (locale === "ru" ? "выберите бэкенд" : "choose backend")}</strong>
                  </div>
                  <div className="summary-line">
                    <span>{locale === "ru" ? "Выбрано для импорта" : "Import selection"}</span>
                    <strong>{locale === "ru" ? `${discoveredZoneNames.length} зон` : `${discoveredZoneNames.length} zone(s)`}</strong>
                  </div>
                  <div className="summary-line">
                    <span>{locale === "ru" ? "Последнее обнаружение" : "Last discovery"}</span>
                    <strong>{lastDiscoveredBackendName ?? (locale === "ru" ? "не запускался" : "not run")}</strong>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        )}
      </section>
    );
  }

  function renderAdminIdentityPage() {
    const authPosture = authSettingsQuery.data;
    const providersWithSecret = adminIdentityProviders.filter(
      (provider) => provider.hasClientSecret,
    ).length;

    return (
      <section className="page-stack">
        <div className="page-header page-header-stack">
          <div>
            <p className="section-label">{tr(locale, "Identity")}</p>
            <h1>{tr(locale, "Identity providers")}</h1>
          </div>
          <p className="section-copy">
            {locale === "ru"
              ? "Держите состояние авторизации перед глазами, пока редактируете конфиг issuer и правила маппинга claims."
              : "Keep auth posture visible while you edit issuer config and claims mapping."}
          </p>
        </div>

        <section className="admin-summary-strip">
          <div className="admin-summary-copy">
            <p className="section-label">{locale === "ru" ? "Состояние авторизации" : "Auth posture"}</p>
            <strong>
              {locale === "ru"
                ? "Проверяйте резервный вход, число провайдеров и покрытие секретов до редактирования конфигов issuer."
                : "Validate fallback, provider count, and secret coverage before editing issuers."}
            </strong>
            <p>
              {locale === "ru"
                ? "В первом экране оставляйте только действительно важные проверки: резервный вход, активные провайдеры, сохранённые секреты и срок жизни сессии."
                : "Keep only the checks that matter in the first viewport: fallback login, live providers, stored secrets, and session lifetime."}
            </p>
          </div>
          <div className="admin-summary-grid">
            <div className="admin-summary-stat">
              <span>{locale === "ru" ? "Локальный резервный вход" : "Local fallback"}</span>
              <strong>
                {authPosture?.localLoginEnabled
                  ? locale === "ru"
                    ? "включён"
                    : "enabled"
                  : locale === "ru"
                    ? "выключен"
                    : "disabled"}
              </strong>
            </div>
            <div className="admin-summary-stat">
              <span>{locale === "ru" ? "OIDC-провайдеры" : "OIDC providers"}</span>
              <strong>{adminIdentityProviders.length}</strong>
            </div>
            <div className="admin-summary-stat">
              <span>{locale === "ru" ? "Секретов сохранено" : "Secrets stored"}</span>
              <strong>{providersWithSecret}</strong>
            </div>
            <div className="admin-summary-stat">
              <span>{locale === "ru" ? "TTL сессии" : "Session TTL"}</span>
              <strong>
                {authPosture ? `${Math.round(authPosture.sessionTtlSeconds / 3600)}${locale === "ru" ? "ч" : "h"}` : "—"}
              </strong>
            </div>
          </div>
        </section>

        {!isAdmin ? (
          <div className="empty-state">
            <strong>{locale === "ru" ? "Состояние авторизации только для чтения" : "Read-only auth posture"}</strong>
            <p>{locale === "ru" ? "Управление провайдерами входа доступно только админским сессиям." : "Identity provider management is reserved for admin sessions."}</p>
          </div>
        ) : (
          <div className="admin-workspace-layout">
            <section className="panel-surface admin-main-surface">
              <div className="panel-heading">
                <div>
                  <p className="panel-label">{tr(locale, "Providers")}</p>
                  <h2>{tr(locale, "Provider workspace")}</h2>
                </div>
                <span className="panel-meta">
                  {locale === "ru"
                    ? `${adminIdentityProviders.length} провайдеров`
                    : `${adminIdentityProviders.length} providers`}
                </span>
              </div>
              <p className="helper-copy">
                {locale === "ru"
                  ? "Делайте адрес issuer, области доступа и правила маппинга настолько читаемыми, чтобы оператор мог понять синхронизацию ролей без расшифровки сырого JSON."
                  : "Keep issuers, scopes, and mapping rules readable enough that an operator can reason about role sync without decoding raw JSON first."}
              </p>
              <AdminConsole
                {...sharedAdminConsoleProps}
                activeSection="identity"
                activeSectionDescription={adminSectionMeta.identity.description}
                activeSectionLabel={adminSectionMeta.identity.label}
                showHeader={false}
                showSectionHeading={false}
                showTabs={false}
              />
            </section>

            <aside className="admin-side-stack">
              <section className="panel-surface">
                <div className="panel-heading">
                  <div>
                    <p className="panel-label">{locale === "ru" ? "Идентификация с первого взгляда" : "Identity at a glance"}</p>
                    <h2>{locale === "ru" ? "Операционные проверки" : "Operational checks"}</h2>
                  </div>
                </div>
                <div className="summary-stack">
                  <div className="summary-line">
                    <span>{locale === "ru" ? "Локальный резервный вход" : "Local fallback"}</span>
                    <strong>
                      {authPosture?.localLoginEnabled
                        ? locale === "ru"
                          ? "включён"
                          : "enabled"
                        : locale === "ru"
                          ? "выключен"
                          : "disabled"}
                    </strong>
                  </div>
                  <div className="summary-line">
                    <span>{locale === "ru" ? "OIDC-провайдеры" : "OIDC providers"}</span>
                    <strong>{adminIdentityProviders.length}</strong>
                  </div>
                  <div className="summary-line">
                    <span>{locale === "ru" ? "Секретов сохранено" : "Secrets stored"}</span>
                    <strong>{providersWithSecret}</strong>
                  </div>
                  <div className="summary-line">
                    <span>{locale === "ru" ? "Маппинг claims" : "Claims mapping"}</span>
                    <strong>
                      {adminIdentityProviders.length > 0
                        ? (locale === "ru" ? "присутствует" : "present")
                        : (locale === "ru" ? "отсутствует" : "absent")}
                    </strong>
                  </div>
                  <div className="summary-line">
                    <span>{locale === "ru" ? "TTL сессии" : "Session TTL"}</span>
                    <strong>
                      {authPosture ? `${Math.round(authPosture.sessionTtlSeconds / 3600)}${locale === "ru" ? "ч" : "h"}` : "—"}
                    </strong>
                  </div>
                </div>
                <p className="helper-copy">
                  {locale === "ru"
                    ? "Секреты клиента остаются только для записи. Маппинг claims остаётся главным операторским контрактом."
                    : "Client secrets stay write-only. Claims mapping remains the main operator-facing contract."}
                </p>
              </section>
            </aside>
          </div>
        )}
      </section>
    );
  }

  if (!isAuthenticated) {
    const oidcProviders = oidcProvidersQuery.data?.items ?? ([] as OidcProvider[]);

    return (
      <main className={`login-shell ${localeClassName}`}>
        <NotificationTray items={notifications} locale={locale} onDismiss={dismissNotification} />
        <section className="login-panel">
          <div className="shell-preferences">
            <div className={`locale-toggle ${localeAnimating ? "locale-toggle-animating" : ""}`} role="group" aria-label={tr(locale, "Language")}>
              <button
                className={locale === "en" ? "locale-toggle-option locale-toggle-option-active" : "locale-toggle-option"}
                onClick={() => {
                  if (locale !== "en") {
                    setLocaleAnimating(true);
                    setLocale("en");
                  }
                }}
                type="button"
              >
                EN
              </button>
              <button
                className={locale === "ru" ? "locale-toggle-option locale-toggle-option-active" : "locale-toggle-option"}
                onClick={() => {
                  if (locale !== "ru") {
                    setLocaleAnimating(true);
                    setLocale("ru");
                  }
                }}
                type="button"
              >
                RU
              </button>
            </div>
            <button
              aria-label={tr(locale, "Theme")}
              className={`theme-toggle theme-toggle-${themeMode}`}
              onClick={(event) => handleThemeToggle(event.currentTarget)}
              type="button"
            >
              <span className="theme-toggle-track">
                <span className="theme-toggle-thumb" />
              </span>
              <span className="theme-toggle-label">{themeMode === "dark" ? tr(locale, "Dark") : tr(locale, "Light")}</span>
            </button>
          </div>
          <div className="login-copy">
            <p className="section-label">{tr(locale, "Frontend shell")}</p>
            <h1>Zonix control plane</h1>
            <p>
              {locale === "ru"
                ? "DNS-рабочее пространство с маршрутами, деталями зоны, аудитом, inventory бэкендов и админскими потоками в одной аутентифицированной оболочке."
                : "Route-aware DNS workspace with zone detail, audit visibility, backend inventory, and admin flows under one authenticated shell."}
            </p>
          </div>
          <form className="login-form" onSubmit={handleLoginSubmit}>
            <label>
              <span>{tr(locale, "Username")}</span>
              <input
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                value={username}
              />
            </label>
            <label>
              <span>{tr(locale, "Password")}</span>
              <input
                autoComplete="current-password"
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
              {loginMutation.isPending ? tr(locale, "Signing in…") : tr(locale, "Sign in")}
            </button>
            {authSettingsQuery.data?.oidcEnabled ? (
              <div className="login-oidc">
                <div className="login-oidc-header">
                  <span>{tr(locale, "OIDC")}</span>
                  <strong>
                    {oidcProvidersQuery.isLoading
                      ? locale === "ru"
                        ? "поиск…"
                        : "discovering…"
                      : locale === "ru"
                        ? `${oidcProviders.length} провайдер(ов)`
                        : `${oidcProviders.length} provider(s)`}
                  </strong>
                </div>
                {oidcProviders.map((provider) => (
                  <button
                    key={provider.name}
                    className="secondary-button"
                    disabled={oidcLoginMutation.isPending}
                    onClick={() => void handleOidcLogin(provider.name)}
                    type="button"
                  >
                    {oidcLoginMutation.isPending
                      ? tr(locale, "Redirecting…")
                      : locale === "ru"
                        ? `Войти через ${provider.name}`
                        : `Sign in with ${provider.name}`}
                  </button>
                ))}
              </div>
            ) : null}
          </form>
        </section>
        <aside className="login-aside">
          <div className="summary-line">
            <span>{tr(locale, "API status")}</span>
            <strong>{healthQuery.data?.status ?? tr(locale, "checking")}</strong>
          </div>
          <div className="summary-line">
            <span>{tr(locale, "Inventory sync")}</span>
            <strong>{healthQuery.data?.inventorySync ?? tr(locale, "pending")}</strong>
          </div>
          <div className="summary-line">
            <span>{tr(locale, "CSRF")}</span>
            <strong>{boolLabel(locale, authSettingsQuery.data?.csrfEnabled === true)}</strong>
          </div>
          <div className="summary-line">
            <span>{tr(locale, "OIDC")}</span>
            <strong>{boolLabel(locale, authSettingsQuery.data?.oidcEnabled === true)}</strong>
          </div>
        </aside>
      </main>
    );
  }

  return (
    <TutorialProvider
      activeZoneName={activeZoneName}
      isAuthenticated={isAuthenticated}
      locale={locale}
      navigate={navigate}
      role={currentUser?.role ?? null}
      route={route}
      themeMode={themeMode}
      userName={currentUser?.username ?? null}
      preferredZoneName={jumpZoneName || null}
    >
      <main className={`shell-layout ${localeClassName}`}>
        <NotificationTray items={notifications} locale={locale} onDismiss={dismissNotification} />
        <aside className="shell-sidebar">
        <div className="sidebar-header">
          <p className="section-label">{tr(locale, "Workspace")}</p>
          <h2>Zonix</h2>
          <div className="sidebar-header-meta">
            <p>{currentUser?.username}</p>
            <span className="sidebar-role">{roleLabel(locale, currentUser?.role)}</span>
          </div>
        </div>
        <nav className="side-nav" aria-label={locale === "ru" ? "Основная навигация" : "Primary navigation"}>
          <RouteLink
            active={route.kind === "zones"}
            dataTour="shell-nav-zones"
            href={routeToHash({ kind: "zones" })}
          >
            {tr(locale, "Zones")}
          </RouteLink>
          {activeZoneName ? (
          <RouteLink
            active={route.kind === "zone"}
            dataTour="shell-nav-zone"
            href={routeToHash({ kind: "zone", zoneName: activeZoneName })}
          >
            {locale === "ru" ? `Зона: ${activeZoneName}` : `Zone: ${activeZoneName}`}
          </RouteLink>
          ) : null}
          <RouteLink
            active={route.kind === "backends"}
            dataTour="shell-nav-backends"
            href={routeToHash({ kind: "backends" })}
          >
            {tr(locale, "Backends")}
          </RouteLink>
          <RouteLink
            active={route.kind === "audit"}
            dataTour="shell-nav-audit"
            href={routeToHash({ kind: "audit" })}
          >
            {tr(locale, "Audit")}
          </RouteLink>
          <div className="side-nav-divider" />
          <RouteLink
            active={route.kind === "admin-access"}
            dataTour="shell-nav-admin-access"
            hidden={!isAdmin}
            href={routeToHash({ kind: "admin-access" })}
          >
            {tr(locale, "Users & grants")}
          </RouteLink>
          <RouteLink
            active={route.kind === "admin-backends"}
            dataTour="shell-nav-admin-backends"
            hidden={!isAdmin}
            href={routeToHash({ kind: "admin-backends" })}
          >
            {tr(locale, "Backend config")}
          </RouteLink>
          <RouteLink
            active={route.kind === "admin-identity"}
            dataTour="shell-nav-admin-identity"
            hidden={!isAdmin}
            href={routeToHash({ kind: "admin-identity" })}
          >
            {tr(locale, "Identity providers")}
          </RouteLink>
        </nav>
      </aside>

        <section className="shell-main">
          <header className="shell-header">
            <div
              className="shell-header-primary"
              aria-label="Session overview"
              data-tour="shell-header-primary"
            >
              <span className="shell-header-chip">{shellCountLabels.zones}</span>
              <span className="shell-header-chip">{shellCountLabels.backends}</span>
            </div>
            <div className="shell-header-actions">
              <div
                className={`locale-toggle ${localeAnimating ? "locale-toggle-animating" : ""}`}
                data-tour="shell-locale-toggle"
                role="group"
                aria-label={tr(locale, "Language")}
              >
                <button
                  className={locale === "en" ? "locale-toggle-option locale-toggle-option-active" : "locale-toggle-option"}
                  onClick={() => {
                    if (locale !== "en") {
                      setLocaleAnimating(true);
                      setLocale("en");
                    }
                  }}
                  type="button"
                >
                  EN
                </button>
                <button
                  className={locale === "ru" ? "locale-toggle-option locale-toggle-option-active" : "locale-toggle-option"}
                  onClick={() => {
                    if (locale !== "ru") {
                      setLocaleAnimating(true);
                      setLocale("ru");
                    }
                  }}
                  type="button"
                >
                  RU
                </button>
              </div>
              <button
                aria-label={tr(locale, "Theme")}
                className={`theme-toggle theme-toggle-${themeMode}`}
                data-tour="shell-theme-toggle"
                onClick={(event) => handleThemeToggle(event.currentTarget)}
                type="button"
              >
                <span className="theme-toggle-track">
                  <span className="theme-toggle-thumb" />
                </span>
                <span className="theme-toggle-label">{themeMode === "dark" ? tr(locale, "Dark") : tr(locale, "Light")}</span>
              </button>
              <label className="compact-select">
                <span>{tr(locale, "Zone")}</span>
                <select
                  aria-label={locale === "ru" ? "Перейти к зоне" : "Jump to zone"}
                  data-tour="shell-zone-jump"
                  onChange={(event) => navigate({ kind: "zone", zoneName: event.target.value })}
                  value={jumpZoneName}
                >
                  {zones.map((zone) => (
                    <option key={zone.name} value={zone.name}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </label>
              <TutorialLauncherButton />
              <button
                className="secondary-button"
                disabled={logoutMutation.isPending}
                onClick={() => logoutMutation.mutate()}
                type="button"
              >
                {tr(locale, "Sign out")}
              </button>
            </div>
          </header>

          <div className="page-stage" key={`${routeToHash(route)}-${locale}`}>
            {route.kind === "zones" ? (
              <ZonesPage
                activeZoneName={activeZoneName}
                availableBackends={visibleBackends}
                currentRole={currentUser?.role ?? null}
                error={zonesQuery.error}
                loading={zonesQuery.isLoading}
                locale={locale}
                onOpenZone={(zoneName) => navigate({ kind: "zone", zoneName })}
                searchQuery={zoneSearch}
                setSearchQuery={setZoneSearch}
                zones={filteredZones}
              />
            ) : null}
            {route.kind === "zone" ? renderZoneDetailPage() : null}
            {route.kind === "backends" ? renderBackendsPage() : null}
            {route.kind === "audit" ? renderAuditPage() : null}
            {route.kind === "admin-access" ? renderAdminAccessPage() : null}
            {route.kind === "admin-backends" ? renderAdminBackendsPage() : null}
            {route.kind === "admin-identity" ? renderAdminIdentityPage() : null}
          </div>
      </section>

        <RecordEditorDrawer
          canWrite={canWriteRecords}
          initialRecord={editorState?.record ?? null}
          locale={locale}
          mode={editorState?.mode ?? "create"}
          onClose={() => setEditorState(null)}
          onPreview={handleRecordPreview}
          open={editorState !== null && activeZoneName !== null}
          pending={previewMutation.isPending}
          zoneName={activeZoneName ?? ""}
        />
        <PreviewModal
          locale={locale}
          onCancel={() => setPreviewState(null)}
          onConfirm={() => void handleConfirmPreview()}
          pending={actingMutationPending}
          state={previewState}
        />
      </main>
    </TutorialProvider>
  );
}
