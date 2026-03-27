import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchBackends,
  fetchHealth,
  fetchSession,
  fetchZone,
  fetchZoneRecords,
  fetchZones,
  login,
  logout,
} from "./api";
import "./styles.css";

export function App() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [selectedZoneName, setSelectedZoneName] = useState<string | null>(null);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false,
  });
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: fetchSession,
    retry: false,
  });
  const backendsQuery = useQuery({
    queryKey: ["backends"],
    queryFn: fetchBackends,
    enabled: sessionQuery.data?.authenticated === true,
    retry: false,
  });
  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: fetchZones,
    enabled: sessionQuery.data?.authenticated === true,
    retry: false,
  });
  const zoneDetailQuery = useQuery({
    queryKey: ["zone", selectedZoneName],
    queryFn: () => fetchZone(selectedZoneName as string),
    enabled:
      sessionQuery.data?.authenticated === true && selectedZoneName !== null,
    retry: false,
  });
  const zoneRecordsQuery = useQuery({
    queryKey: ["zone-records", selectedZoneName],
    queryFn: () => fetchZoneRecords(selectedZoneName as string),
    enabled:
      sessionQuery.data?.authenticated === true && selectedZoneName !== null,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async (session) => {
      queryClient.setQueryData(["session"], session);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["backends"] }),
        queryClient.invalidateQueries({ queryKey: ["zones"] }),
      ]);
    },
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async (session) => {
      queryClient.setQueryData(["session"], session);
      queryClient.removeQueries({ queryKey: ["backends"] });
      queryClient.removeQueries({ queryKey: ["zones"] });
      queryClient.removeQueries({ queryKey: ["zone"] });
      queryClient.removeQueries({ queryKey: ["zone-records"] });
      setSelectedZoneName(null);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate({ username, password });
  }

  const session = sessionQuery.data;
  const isAuthenticated =
    session?.authenticated === true && session.user !== null;
  const currentUser = isAuthenticated ? session.user : null;
  const zoneItems = zonesQuery.data?.items;

  useEffect(() => {
    if (!isAuthenticated) {
      setSelectedZoneName(null);
      return;
    }

    if (!zoneItems || zoneItems.length === 0) {
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

  return (
    <main className="app-shell">
      <div className="backdrop-orb orb-left" />
      <div className="backdrop-orb orb-right" />

      <section className="hero-shell">
        <section className="hero-copy">
          <p className="eyebrow">Zonix Day 10</p>
          <h1>
            {isAuthenticated
              ? "Real PowerDNS reads are live."
              : "Sign in to Zonix."}
          </h1>
          <p className="lede">
            {isAuthenticated
              ? "The first live backend demo is in place: local login, session cookie, PowerDNS zone listing, zone detail, and normalized record inventory through the control plane."
              : "Authenticate with the bootstrap admin, then inspect live PowerDNS-backed zones and record sets through the backend-agnostic API."}
          </p>

          {isAuthenticated ? (
            <div className="hero-actions">
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
                onClick={() => logoutMutation.mutate()}
                type="button"
              >
                Sign out
              </button>
            </div>
          ) : (
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
                Sign in
              </button>
              {loginMutation.isError ? (
                <p className="status-error">Invalid username or password.</p>
              ) : null}
            </form>
          )}
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
            </dl>
          ) : null}
        </aside>
      </section>

      <section className="marquee">
        <span>Local auth</span>
        <span>Session cookie</span>
        <span>PowerDNS read-only adapter</span>
        <span>Zone detail</span>
        <span>Record inventory</span>
        <span>First live backend demo</span>
      </section>

      <section className="grid">
        <article className="panel panel-story">
          <p className="panel-label">Configured backends</p>
          <h2>What the current identity can reach.</h2>
          <p>
            Day 10 keeps the UI on core models, but the data now comes from a
            live read-only PowerDNS adapter instead of the mock registry.
          </p>
          {isAuthenticated ? (
            <ul className="resource-list">
              {backendsQuery.data?.items.map((backend) => (
                <li key={backend.name}>
                  <div className="resource-copy">
                    <strong>{backend.name}</strong>
                    <span>{backend.backendType}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="placeholder-copy">
              Sign in to load configured backends.
            </p>
          )}
        </article>

        <article className="panel panel-roadmap">
          <p className="panel-label">Accessible zones</p>
          <h2>Scoped by current role and grants.</h2>
          {isAuthenticated ? (
            <ul className="resource-list">
              {(zoneItems ?? []).map((zone) => (
                <li key={zone.name} className="resource-item-action">
                  <div className="resource-copy">
                    <strong>{zone.name}</strong>
                    <span>{zone.backendName}</span>
                  </div>
                  <button
                    className="primary-button secondary-button"
                    onClick={() => setSelectedZoneName(zone.name)}
                    type="button"
                  >
                    Inspect
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="placeholder-copy">
              Zone visibility appears after login.
            </p>
          )}
        </article>

        <article className="panel panel-roadmap">
          <p className="panel-label">Zone detail</p>
          <h2>{zoneDetailQuery.data?.name ?? "Pick a zone to inspect."}</h2>
          {isAuthenticated && selectedZoneName === null ? (
            <p className="placeholder-copy">
              Choose a zone from the live list.
            </p>
          ) : null}
          {zoneDetailQuery.isError ? (
            <p className="status-error">
              Zone detail could not be loaded from the backend.
            </p>
          ) : null}
          {zoneDetailQuery.data ? (
            <dl className="status-list">
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

        <article className="panel panel-story">
          <p className="panel-label">Record sets</p>
          <h2>Normalized RRsets, not PowerDNS payloads.</h2>
          {zoneRecordsQuery.isError ? (
            <p className="status-error">
              Record inventory could not be loaded from the backend.
            </p>
          ) : null}
          {zoneRecordsQuery.data ? (
            <ul className="resource-list">
              {zoneRecordsQuery.data.items.map((record) => (
                <li
                  key={`${record.name}-${record.recordType}`}
                  className="record-item"
                >
                  <div className="resource-copy">
                    <strong>
                      {record.name} {record.recordType}
                    </strong>
                    <span>TTL {record.ttl}</span>
                  </div>
                  <p className="record-values">{record.values.join(", ")}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="placeholder-copy">
              Record sets appear after selecting a zone.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}
