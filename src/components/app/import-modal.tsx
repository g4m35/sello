"use client";

import { useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { Banner, Btn, Modal } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { useSession } from "@/components/providers/session-provider";
import { IMPORT_TARGET_FIELDS } from "@/lib/listing-import";

type Stage = "upload" | "mapping" | "preview" | "importing" | "done";
type ParsedCsv = { headers: string[]; rows: string[][]; fileName: string };

// Minimal RFC-4180-ish CSV parser (handles quotes, escaped quotes, CRLF).
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((c) => c.trim() !== "")) records.push(record);
      record = [];
    } else field += ch;
  }
  if (field !== "" || record.length) {
    record.push(field);
    if (record.some((c) => c.trim() !== "")) records.push(record);
  }
  const [headers = [], ...rows] = records;
  return { headers: headers.map((h) => h.trim()), rows };
}

function autoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of IMPORT_TARGET_FIELDS) {
    const match = headers.find((h) => {
      const hl = h.toLowerCase();
      return hl === field.key || hl.includes(field.key) || (field.key === "price" && hl.includes("cost"));
    });
    if (match) map[field.key] = match;
  }
  return map;
}

function priceToCents(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function ImportModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { token } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [created, setCreated] = useState(0);
  const [error, setError] = useState("");

  function reset() {
    setStage("upload");
    setCsv(null);
    setMapping({});
    setCreated(0);
    setError("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function onFile(file: File) {
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    if (!headers.length) {
      setError("That file has no readable header row.");
      return;
    }
    setError("");
    setCsv({ headers, rows, fileName: file.name });
    setMapping(autoMap(headers));
    setStage("mapping");
  }

  function cell(row: string[], fieldKey: string): string {
    if (!csv) return "";
    const header = mapping[fieldKey];
    if (!header) return "";
    const idx = csv.headers.indexOf(header);
    return idx >= 0 ? (row[idx] ?? "").trim() : "";
  }

  const validRows = csv
    ? csv.rows.filter((r) => cell(r, "title").length > 0)
    : [];
  const invalidCount = csv ? csv.rows.length - validRows.length : 0;

  async function runImport() {
    if (!csv) return;
    setStage("importing");
    setError("");
    const payload = validRows.map((r) => ({
      title: cell(r, "title"),
      brand: cell(r, "brand") || null,
      size: cell(r, "size") || null,
      color: cell(r, "color") || null,
      condition: cell(r, "condition") || null,
      sku: cell(r, "sku") || null,
      priceCents: priceToCents(cell(r, "price")),
    }));
    try {
      const res = await api.importRows(token, payload);
      setCreated(res.created);
      setStage("done");
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Import failed");
      setStage("preview");
    }
  }

  const mappedCount = IMPORT_TARGET_FIELDS.filter((f) => mapping[f.key]).length;

  return (
    <Modal open={open} onClose={stage === "importing" ? undefined : handleClose} wide>
      <div className="modal__head">
        <div>
          <div className="modal__title">Import from CSV</div>
          <div className="modal__sub">
            {stage === "upload" && "Bulk-add items as drafts. Nothing publishes automatically."}
            {csv && stage !== "upload" && `${csv.fileName} · ${csv.rows.length} rows · ${csv.headers.length} columns`}
          </div>
        </div>
        {stage !== "importing" && (
          <button className="modal__close" onClick={handleClose}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      <div className="modal__body stack-4">
        {error && <Banner variant="error" title={error} />}

        {stage === "upload" && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            <button className="dropzone" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={26} />
              <div style={{ fontWeight: 500 }}>Drop a CSV or click to choose</div>
              <div className="t-small">Rows are created as drafts you can edit and publish later.</div>
            </button>
            <Banner
              variant="info"
              title="Nothing publishes automatically"
              desc="Imported rows land in your inventory as drafts. Map the columns, review, then create."
            />
          </>
        )}

        {stage === "mapping" && csv && (
          <>
            <div className="map-head">
              <div className="t-micro">Field</div>
              <div />
              <div className="t-micro">CSV column</div>
              <div className="t-micro" style={{ textAlign: "right" }}>Sample</div>
            </div>
            <div className="map-list">
              {IMPORT_TARGET_FIELDS.map((f) => {
                const sample = csv.rows[0] ? cell(csv.rows[0], f.key) : "";
                const unmapped = f.required && !mapping[f.key];
                return (
                  <div className="map-row" key={f.key}>
                    <div className="map-row__field">
                      {f.label}
                      {f.required && <span className="field__req">*</span>}
                    </div>
                    <Icon name="arrow-r" size={13} style={{ color: "var(--ink-3)" }} />
                    <select
                      className={`select ${unmapped ? "input--error" : ""}`}
                      value={mapping[f.key] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [f.key]: e.target.value }))
                      }
                    >
                      <option value="">— skip —</option>
                      {csv.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <div className="map-row__sample">{sample || "—"}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {stage === "preview" && csv && (
          <>
            <div className="t-small">
              {validRows.length} of {csv.rows.length} rows ready
              {invalidCount > 0 && ` · ${invalidCount} skipped (missing title)`}
            </div>
            <div className="table-wrap" style={{ borderTop: "1px solid var(--line)", borderRadius: "var(--r-4)", maxHeight: 320, overflow: "auto" }}>
              <table className="table import-table">
                <thead>
                  <tr>
                    {IMPORT_TARGET_FIELDS.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      {IMPORT_TARGET_FIELDS.map((f) => (
                        <td key={f.key}>{cell(r, f.key) || <span className="muted">—</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {stage === "importing" && (
          <div className="stack-2">
            <div className="progress">
              <div className="progress__bar" style={{ width: "100%" }} />
            </div>
            <div className="t-small">Creating {validRows.length} drafts…</div>
          </div>
        )}

        {stage === "done" && (
          <div className="import-summary">
            <div className="import-summary__row">
              <Icon name="check-c" size={20} style={{ color: "var(--status-ready-ink)" }} />
              <div>
                <div style={{ fontWeight: 500 }}>{created} drafts created</div>
                <div className="t-small">Find them in your inventory, ready to edit and publish.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="modal__foot">
        {stage === "upload" && (
          <>
            <div />
            <Btn variant="ghost" onClick={handleClose}>Cancel</Btn>
          </>
        )}
        {stage === "mapping" && (
          <>
            <div className="t-small">{mappedCount} of {IMPORT_TARGET_FIELDS.length} fields mapped</div>
            <div className="row">
              <Btn variant="ghost" onClick={() => setStage("upload")}>Back</Btn>
              <Btn
                variant="primary"
                disabled={!mapping["title"]}
                onClick={() => setStage("preview")}
              >
                Preview rows
              </Btn>
            </div>
          </>
        )}
        {stage === "preview" && (
          <>
            <div className="t-small">{validRows.length} drafts will be created</div>
            <div className="row">
              <Btn variant="ghost" onClick={() => setStage("mapping")}>Back to mapping</Btn>
              <Btn variant="accent" disabled={validRows.length === 0} onClick={runImport}>
                Import {validRows.length} items
              </Btn>
            </div>
          </>
        )}
        {stage === "done" && (
          <>
            <div />
            <div className="row">
              <Btn variant="ghost" onClick={handleClose}>Close</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  handleClose();
                  onDone?.();
                }}
              >
                View in inventory
              </Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
