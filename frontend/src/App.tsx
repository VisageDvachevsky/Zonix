import { useQuery } from "@tanstack/react-query";

import { fetchHealth } from "./api";
import "./styles.css";

const stackCards = [
  {
    title: "Frontend",
    value: "React + TS",
    detail: "TanStack Query and Zod drive API contracts from day zero.",
  },
  {
    title: "Backend",
    value: "FastAPI",
    detail: "Health, readiness, migrations, bootstrap admin, and OpenAPI baseline.",
  },
  {
    title: "Adapters",
    value: "2 tracks",
    detail: "PowerDNS first, RFC2136/BIND-compatible with explicit capability flags.",
  },
];

export function App() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false,
  });

  return (
    <main className="app-shell">
      <div className="backdrop-orb orb-left" />
      <div className="backdrop-orb orb-right" />

      <section className="hero-shell">
        <section className="hero-copy">
          <p className="eyebrow">Zonix v0.1</p>
          <h1>Operate DNS without tab-hopping or blind writes.</h1>
          <p className="lede">
            The shell already sets the tone: backend-agnostic capability modeling, verified API
            contracts, and a launch path toward a serious DNS control plane.
          </p>

          <div className="hero-actions">
            <div className="inline-stat">
              <span className="inline-stat-label">Scope</span>
              <strong>Frozen for MVP</strong>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">Demo target</span>
              <strong>PowerDNS + RFC2136</strong>
            </div>
          </div>
        </section>

        <aside className="status-panel">
          <div className="status-panel-header">
            <span className="status-kicker">System pulse</span>
            <span
              className={`status-dot ${
                healthQuery.data?.status === "ok" ? "status-dot-live" : "status-dot-muted"
              }`}
            />
          </div>
          <h2>Backend connectivity</h2>
          {healthQuery.isLoading ? <p>Checking API health...</p> : null}
          {healthQuery.isError ? (
            <p className="status-error">
              Backend unavailable. Start the compose stack or `npm run dev:backend`.
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
        <span>Capability matrix</span>
        <span>Compose bootstrap</span>
        <span>Audit-ready foundation</span>
        <span>Typed frontend contracts</span>
        <span>PowerDNS and RFC2136 track</span>
      </section>

      <section className="grid">
        <article className="panel panel-story">
          <p className="panel-label">Launch posture</p>
          <h2>Built like an operations product, not a landing page.</h2>
          <p>
            The first screen should already communicate confidence: clear system pulse, adapter
            honesty, and a structure that can grow into zones, records, audit, and admin flows.
          </p>
        </article>

        <article className="panel panel-roadmap">
          <p className="panel-label">Immediate runway</p>
          <ul className="delivery-list">
            <li>Local auth skeleton on top of bootstrap admin and migrations.</li>
            <li>Backend registry, zone grants, and first protected list flows.</li>
            <li>Real PowerDNS read path replacing placeholder shell content.</li>
          </ul>
        </article>
      </section>

      <section className="card-grid">
        {stackCards.map((card) => (
          <article key={card.title} className="stack-card">
            <p className="panel-label">{card.title}</p>
            <h3>{card.value}</h3>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
