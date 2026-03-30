import { useEffect, useState, type FormEvent } from "react";

import {
  recordDraftSchema,
  type RecordSet,
  type RecordType,
} from "./api";
import { tr, type Locale } from "./uiText";

type EntryRow = {
  id: string;
  left: string;
  right: string;
  extra?: string;
  extra2?: string;
};

type SoaState = {
  primaryNs: string;
  responsibleMailbox: string;
  serial: string;
  refresh: string;
  retry: string;
  expire: string;
  minimum: string;
};

type EditorState = {
  name: string;
  recordType: RecordType;
  ttl: string;
  valueLines: string;
  target: string;
  mxRows: EntryRow[];
  srvRows: EntryRow[];
  caaRows: EntryRow[];
  soa: SoaState;
};

export type RecordEditorSubmission = {
  operation: "create" | "update";
  zoneName: string;
  name: string;
  recordType: RecordType;
  ttl: number;
  values: string[];
  expectedVersion?: string;
};

type RecordEditorDrawerProps = {
  canWrite: boolean;
  initialRecord?: RecordSet | null;
  locale: Locale;
  mode: "create" | "update";
  onClose: () => void;
  onPreview: (submission: RecordEditorSubmission) => Promise<void> | void;
  open: boolean;
  pending: boolean;
  zoneName: string;
};

const defaultSoaState: SoaState = {
  primaryNs: "",
  responsibleMailbox: "",
  serial: "1",
  refresh: "3600",
  retry: "600",
  expire: "1209600",
  minimum: "3600",
};

function createRow(partial?: Partial<EntryRow>): EntryRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    left: partial?.left ?? "",
    right: partial?.right ?? "",
    extra: partial?.extra ?? "",
    extra2: partial?.extra2 ?? "",
  };
}

function createInitialState(record?: RecordSet | null): EditorState {
  const base: EditorState = {
    name: record?.name ?? "@",
    recordType: record?.recordType ?? "A",
    ttl: String(record?.ttl ?? 300),
    valueLines: "",
    target: "",
    mxRows: [createRow()],
    srvRows: [createRow()],
    caaRows: [createRow({ left: "0", right: "issue" })],
    soa: { ...defaultSoaState },
  };

  if (!record) {
    base.valueLines = "";
    return base;
  }

  switch (record.recordType) {
    case "A":
    case "AAAA":
    case "TXT":
      base.valueLines = record.values.join("\n");
      return base;
    case "CNAME":
    case "NS":
    case "PTR":
      base.target = record.values[0] ?? "";
      return base;
    case "MX":
      base.mxRows =
        record.values.map((value) => {
          const [left, ...rest] = value.trim().split(/\s+/);
          return createRow({ left: left ?? "", right: rest.join(" ") });
        }) || [createRow()];
      return base;
    case "SRV":
      base.srvRows =
        record.values.map((value) => {
          const [priority, weight, port, ...rest] = value.trim().split(/\s+/);
          return createRow({
            left: priority ?? "",
            right: weight ?? "",
            extra: port ?? "",
            extra2: rest.join(" "),
          });
        }) || [createRow()];
      return base;
    case "CAA":
      base.caaRows =
        record.values.map((value) => {
          const [flags, tag, ...rest] = value.trim().split(/\s+/);
          return createRow({
            left: flags ?? "",
            right: tag ?? "",
            extra: rest.join(" "),
          });
        }) || [createRow({ left: "0", right: "issue" })];
      return base;
    case "SOA": {
      const [
        primaryNs,
        responsibleMailbox,
        serial,
        refresh,
        retry,
        expire,
        minimum,
      ] = (record.values[0] ?? "").trim().split(/\s+/);
      base.soa = {
        primaryNs: primaryNs ?? "",
        responsibleMailbox: responsibleMailbox ?? "",
        serial: serial ?? "1",
        refresh: refresh ?? "3600",
        retry: retry ?? "600",
        expire: expire ?? "1209600",
        minimum: minimum ?? "3600",
      };
      return base;
    }
  }
}

function buildValues(state: EditorState): string[] {
  switch (state.recordType) {
    case "A":
    case "AAAA":
    case "TXT":
      return state.valueLines
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
    case "CNAME":
    case "NS":
    case "PTR":
      return [state.target.trim()].filter(Boolean);
    case "MX":
      return state.mxRows
        .map((row) => `${row.left.trim()} ${row.right.trim()}`.trim())
        .filter(Boolean);
    case "SRV":
      return state.srvRows
        .map((row) =>
          `${row.left.trim()} ${row.right.trim()} ${row.extra?.trim() ?? ""} ${row.extra2?.trim() ?? ""}`.trim(),
        )
        .filter(Boolean);
    case "CAA":
      return state.caaRows
        .map((row) =>
          `${row.left.trim()} ${row.right.trim()} ${row.extra?.trim() ?? ""}`.trim(),
        )
        .filter(Boolean);
    case "SOA":
      return [
        [
          state.soa.primaryNs.trim(),
          state.soa.responsibleMailbox.trim(),
          state.soa.serial.trim(),
          state.soa.refresh.trim(),
          state.soa.retry.trim(),
          state.soa.expire.trim(),
          state.soa.minimum.trim(),
        ]
          .filter(Boolean)
          .join(" "),
      ];
  }
}

function updateRow(
  rows: EntryRow[],
  rowId: string,
  patch: Partial<EntryRow>,
): EntryRow[] {
  return rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row));
}

function getDrawerHeading(mode: "create" | "update", recordType: RecordType) {
  return mode === "create" ? `Create ${recordType} record` : `Edit ${recordType} record`;
}

export function RecordEditorDrawer(props: RecordEditorDrawerProps) {
  const [state, setState] = useState<EditorState>(() =>
    createInitialState(props.initialRecord),
  );
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (props.open) {
      setState(createInitialState(props.initialRecord));
      setFormError(null);
    }
  }, [props.initialRecord, props.open]);

  if (!props.open) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsedTtl = Number(state.ttl);
    if (!Number.isInteger(parsedTtl) || parsedTtl <= 0) {
      setFormError(
        props.locale === "ru"
          ? "TTL должен быть положительным целым числом."
          : "TTL must be a positive integer.",
      );
      return;
    }

    const draftCandidate = {
      zoneName: props.zoneName,
      name: state.name.trim(),
      recordType: state.recordType,
      ttl: parsedTtl,
      values: buildValues(state),
    };

    const parsed = recordDraftSchema.safeParse(draftCandidate);
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ??
          (props.locale === "ru" ? "Форма записи заполнена неверно." : "Record form is invalid."),
      );
      return;
    }

    await props.onPreview({
      operation: props.mode,
      zoneName: parsed.data.zoneName,
      name: parsed.data.name,
      recordType: parsed.data.recordType,
      ttl: parsed.data.ttl,
      values: parsed.data.values,
      expectedVersion:
        props.mode === "update" ? props.initialRecord?.version : undefined,
    });
  }

  const drawerHeading = getDrawerHeading(props.mode, state.recordType);

  return (
    <div className="overlay-shell" role="presentation">
      <div className="overlay-backdrop" onClick={props.onClose} />
      <aside className="overlay-panel overlay-panel-wide" aria-label={props.locale === "ru" ? "Редактор записи" : "Record editor"}>
        <div className="overlay-panel-header">
          <div>
            <p className="section-label">{tr(props.locale, "Record form")}</p>
            <h2>{drawerHeading}</h2>
          </div>
          <button className="secondary-button" onClick={props.onClose} type="button">
            {tr(props.locale, "Close")}
          </button>
        </div>

        <form className="stacked-form overlay-form" onSubmit={handleSubmit}>
          <div className="form-grid form-grid-two">
            <label>
              <span>{tr(props.locale, "Name")}</span>
              <input
                autoFocus
                disabled={!props.canWrite || props.pending}
                onChange={(event) =>
                  setState((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="@"
                value={state.name}
              />
            </label>
            <label>
              <span>TTL</span>
              <input
                disabled={!props.canWrite || props.pending}
                inputMode="numeric"
                onChange={(event) =>
                  setState((current) => ({ ...current, ttl: event.target.value }))
                }
                value={state.ttl}
              />
            </label>
          </div>

          <label>
            <span>{tr(props.locale, "Record type")}</span>
            <select
              disabled={!props.canWrite || props.pending}
              onChange={(event) => {
                const nextType = event.target.value as RecordType;
                setState((current) => {
                  const resetState = props.initialRecord
                    ? createInitialState({
                        ...props.initialRecord,
                        recordType: nextType,
                      })
                    : createInitialState({
                        zoneName: props.zoneName,
                        name: current.name,
                        recordType: nextType,
                        ttl: Number(current.ttl) || 300,
                        values: [],
                        version: "draft",
                      });
                  return {
                    ...resetState,
                    name: current.name,
                    ttl: current.ttl,
                  };
                });
              }}
              value={state.recordType}
            >
              {(
                ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "PTR", "CAA", "SOA"] as const
              ).map((recordType) => (
                <option key={recordType} value={recordType}>
                  {recordType}
                </option>
              ))}
            </select>
          </label>

          <section className="record-type-stage" key={state.recordType}>
            <div className="record-type-summary">
              <span className="section-label">{tr(props.locale, "Type-specific fields")}</span>
              <p className="helper-copy">
                {state.recordType === "TXT"
                  ? props.locale === "ru"
                    ? "Указывайте по одному TXT-значению на строку и держите quoting единообразным."
                    : "Paste one TXT value per line and keep quoting consistent."
                  : state.recordType === "MX"
                    ? props.locale === "ru"
                      ? "Укажите preference и mail exchanger отдельными полями."
                      : "Capture preference and mail exchanger explicitly."
                    : state.recordType === "SRV"
                      ? props.locale === "ru"
                        ? "SRV-записи требуют priority, weight, port и target."
                        : "Service records require priority, weight, port, and target."
                      : state.recordType === "CAA"
                        ? props.locale === "ru"
                          ? "Разделяйте flags, tag и authority на отдельные поля."
                          : "Split flags, tag, and authority into separate fields."
                        : state.recordType === "SOA"
                          ? props.locale === "ru"
                            ? "Редактируйте полный SOA-кортеж через структурированные поля."
                            : "Edit the full SOA tuple directly from structured inputs."
                          : state.recordType === "CNAME" || state.recordType === "NS" || state.recordType === "PTR"
                            ? props.locale === "ru"
                              ? "Для single-target записей указывается один канонический hostname."
                              : "Single-target records stay as one canonical hostname."
                            : props.locale === "ru"
                              ? "Указывайте по одному адресу или значению на строку."
                              : "List one address or value per line."}
              </p>
            </div>

            {(state.recordType === "A" ||
              state.recordType === "AAAA" ||
              state.recordType === "TXT") ? (
              <label>
                <span>
                  {state.recordType === "TXT"
                    ? tr(props.locale, "Text values")
                    : state.recordType === "A"
                      ? tr(props.locale, "IPv4 addresses")
                      : tr(props.locale, "IPv6 addresses")}
                </span>
                <textarea
                  disabled={!props.canWrite || props.pending}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      valueLines: event.target.value,
                    }))
                  }
                  placeholder={props.locale === "ru" ? "Одно значение на строку…" : "One value per line…"}
                  rows={4}
                  value={state.valueLines}
                />
              </label>
            ) : null}

            {(state.recordType === "CNAME" ||
              state.recordType === "NS" ||
              state.recordType === "PTR") ? (
              <label>
                <span>{tr(props.locale, "Target hostname")}</span>
                <input
                  disabled={!props.canWrite || props.pending}
                  onChange={(event) =>
                    setState((current) => ({ ...current, target: event.target.value }))
                  }
                  placeholder="target.example.com…"
                  value={state.target}
                />
              </label>
            ) : null}

            {state.recordType === "MX" ? (
              <section className="editor-section">
                <div className="editor-section-header">
                  <div>
                    <strong>{tr(props.locale, "Mail exchangers")}</strong>
                    <p className="helper-copy">
                      {props.locale === "ru"
                        ? "Укажите priority и target для каждой строки."
                        : "Define preference and target per line item."}
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        mxRows: [...current.mxRows, createRow()],
                      }))
                    }
                    type="button"
                  >
                    {tr(props.locale, "Add MX value")}
                  </button>
                </div>
                {state.mxRows.map((row) => (
                  <div key={row.id} className="form-grid form-grid-row">
                    <input
                      aria-label="MX preference"
                      disabled={!props.canWrite || props.pending}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          mxRows: updateRow(current.mxRows, row.id, {
                            left: event.target.value,
                          }),
                        }))
                      }
                      placeholder="10"
                      value={row.left}
                    />
                    <input
                      aria-label="MX exchange"
                      disabled={!props.canWrite || props.pending}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          mxRows: updateRow(current.mxRows, row.id, {
                            right: event.target.value,
                          }),
                        }))
                      }
                      placeholder="mail.example.com…"
                      value={row.right}
                    />
                    <button
                      className="secondary-button secondary-button-danger"
                      disabled={state.mxRows.length === 1}
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          mxRows: current.mxRows.filter((item) => item.id !== row.id),
                        }))
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </section>
            ) : null}

            {state.recordType === "SRV" ? (
              <section className="editor-section">
                <div className="editor-section-header">
                  <div>
                    <strong>Service targets</strong>
                    <p className="helper-copy">
                      Each entry maps priority, weight, port, and target.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        srvRows: [...current.srvRows, createRow()],
                      }))
                    }
                    type="button"
                  >
                    Add SRV value
                  </button>
                </div>
                {state.srvRows.map((row) => (
                  <div key={row.id} className="form-grid form-grid-four">
                    <input
                      aria-label="SRV priority"
                      disabled={!props.canWrite || props.pending}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          srvRows: updateRow(current.srvRows, row.id, {
                            left: event.target.value,
                          }),
                        }))
                      }
                      placeholder="10"
                      value={row.left}
                    />
                    <input
                      aria-label="SRV weight"
                      disabled={!props.canWrite || props.pending}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          srvRows: updateRow(current.srvRows, row.id, {
                            right: event.target.value,
                          }),
                        }))
                      }
                      placeholder="5"
                      value={row.right}
                    />
                    <input
                      aria-label="SRV port"
                      disabled={!props.canWrite || props.pending}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          srvRows: updateRow(current.srvRows, row.id, {
                            extra: event.target.value,
                          }),
                        }))
                      }
                      placeholder="443"
                      value={row.extra}
                    />
                    <input
                      aria-label="SRV target"
                      disabled={!props.canWrite || props.pending}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          srvRows: updateRow(current.srvRows, row.id, {
                            extra2: event.target.value,
                          }),
                        }))
                      }
                      placeholder="svc.example.com…"
                      value={row.extra2}
                    />
                  </div>
                ))}
              </section>
            ) : null}

            {state.recordType === "CAA" ? (
              <section className="editor-section">
                <div className="editor-section-header">
                  <div>
                    <strong>CAA values</strong>
                    <p className="helper-copy">
                      Capture flags, tag, and authority value explicitly.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        caaRows: [...current.caaRows, createRow({ left: "0", right: "issue" })],
                      }))
                    }
                    type="button"
                  >
                    Add CAA value
                  </button>
                </div>
                {state.caaRows.map((row) => (
                  <div key={row.id} className="form-grid form-grid-three">
                    <input
                      aria-label="CAA flags"
                      disabled={!props.canWrite || props.pending}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          caaRows: updateRow(current.caaRows, row.id, {
                            left: event.target.value,
                          }),
                        }))
                      }
                      placeholder="0"
                      value={row.left}
                    />
                    <select
                      aria-label="CAA tag"
                      disabled={!props.canWrite || props.pending}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          caaRows: updateRow(current.caaRows, row.id, {
                            right: event.target.value,
                          }),
                        }))
                      }
                      value={row.right}
                    >
                      <option value="issue">issue</option>
                      <option value="issuewild">issuewild</option>
                      <option value="iodef">iodef</option>
                    </select>
                    <input
                      aria-label="CAA value"
                      disabled={!props.canWrite || props.pending}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          caaRows: updateRow(current.caaRows, row.id, {
                            extra: event.target.value,
                          }),
                        }))
                      }
                      placeholder="letsencrypt.org…"
                      value={row.extra}
                    />
                  </div>
                ))}
              </section>
            ) : null}

            {state.recordType === "SOA" ? (
              <section className="editor-section">
                <div className="editor-section-header">
                  <div>
                    <strong>SOA fields</strong>
                    <p className="helper-copy">
                      The SOA record is assembled from the seven required fields.
                    </p>
                  </div>
                </div>
                <div className="form-grid form-grid-two">
                  <input
                    aria-label="SOA primary nameserver"
                    disabled={!props.canWrite || props.pending}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        soa: { ...current.soa, primaryNs: event.target.value },
                      }))
                    }
                    placeholder="ns1.example.com…"
                    value={state.soa.primaryNs}
                  />
                  <input
                    aria-label="SOA responsible mailbox"
                    disabled={!props.canWrite || props.pending}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        soa: {
                          ...current.soa,
                          responsibleMailbox: event.target.value,
                        },
                      }))
                    }
                    placeholder="hostmaster.example.com…"
                    value={state.soa.responsibleMailbox}
                  />
                  <input
                    aria-label="SOA serial"
                    disabled={!props.canWrite || props.pending}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        soa: { ...current.soa, serial: event.target.value },
                      }))
                    }
                    placeholder="1"
                    value={state.soa.serial}
                  />
                  <input
                    aria-label="SOA refresh"
                    disabled={!props.canWrite || props.pending}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        soa: { ...current.soa, refresh: event.target.value },
                      }))
                    }
                    placeholder="3600"
                    value={state.soa.refresh}
                  />
                  <input
                    aria-label="SOA retry"
                    disabled={!props.canWrite || props.pending}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        soa: { ...current.soa, retry: event.target.value },
                      }))
                    }
                    placeholder="600"
                    value={state.soa.retry}
                  />
                  <input
                    aria-label="SOA expire"
                    disabled={!props.canWrite || props.pending}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        soa: { ...current.soa, expire: event.target.value },
                      }))
                    }
                    placeholder="1209600"
                    value={state.soa.expire}
                  />
                  <input
                    aria-label="SOA minimum"
                    disabled={!props.canWrite || props.pending}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        soa: { ...current.soa, minimum: event.target.value },
                      }))
                    }
                    placeholder="3600"
                    value={state.soa.minimum}
                  />
                </div>
              </section>
            ) : null}
          </section>

          {formError ? <p className="status-error">{formError}</p> : null}

          <div className="overlay-actions">
            <button
              className="primary-button"
              disabled={!props.canWrite || props.pending}
              type="submit"
            >
          {props.pending ? "Preparing preview…" : "Preview changes"}
            </button>
            <button
              className="secondary-button"
              disabled={props.pending}
              onClick={props.onClose}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
