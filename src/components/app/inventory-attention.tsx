"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type InventoryNotification, type InventoryReviewTask } from "@/lib/api/client";
import { Btn, Modal } from "@/components/ui/primitives";

export function reviewAction(task: InventoryReviewTask) {
  if (task.type === "confirm_possible_sale") return { label: "Confirm sale", explanation: "Confirm that this item sold. Sello will mark it sold and queue supported delisting. Check and remove any other listings that require manual action." };
  if (task.type === "manual_delist_required") return { label: "Confirm removed", explanation: "Confirm you removed this listing on the marketplace. This closes the task; Sello does not remove the external listing for you." };
  return { label: "Mark handled", explanation: "Only close this task after checking and resolving the issue. This records your confirmation; it does not change an external listing or restart automation." };
}

export function InventoryAttentionView({ tasks, notifications, loading, errors, busy, onRefresh, onReview }: {
  tasks: InventoryReviewTask[]; notifications: InventoryNotification[]; loading: boolean; errors: string[]; busy: boolean;
  onRefresh: () => void; onReview: (task: InventoryReviewTask, status: "resolved" | "dismissed") => void;
}) {
  if (!loading && !errors.length && !tasks.length && !notifications.length) return null;
  return <section className="card inventory-attention" aria-label="Inventory attention and updates">
    <div className="card__head"><h2 className="card__title">Needs your attention</h2><Btn size="sm" disabled={loading || busy} onClick={onRefresh}>Refresh</Btn></div>
    <div className="card__body stack-4">
      {loading && <p role="status">Checking for tasks and updates…</p>}
      {errors.map((error) => <p role="alert" key={error}>{error}</p>)}
      {!loading && !errors.length && !tasks.length && <p>No open review tasks.</p>}
      {tasks.map((task) => <article key={task.id} className="stack-2">
        <h3 className="t-h3">{task.title}</h3><p>{task.description}</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {task.inventoryItemId && <Link className="btn btn--secondary btn--sm" href={`/inventory/${encodeURIComponent(task.inventoryItemId)}`}>Review listing</Link>}
          <Btn size="sm" disabled={busy || errors.length > 0} onClick={() => onReview(task, "resolved")}>{reviewAction(task).label}</Btn>
          {task.type === "confirm_possible_sale" && <Btn size="sm" disabled={busy || errors.length > 0} onClick={() => onReview(task, "dismissed")}>Not a sale</Btn>}
        </div>
      </article>)}
      {notifications.length > 0 && <details><summary>Recent updates</summary><div className="stack-4" style={{ marginTop: 16 }}>
        <p className="t-small muted">Past updates are a record of events; they do not confirm current connection or monitoring health.</p>
        {notifications.map((entry) => <article key={entry.id} className="stack-2"><h3 className="t-h3">{entry.title}</h3><p>{entry.body}</p><time className="t-small muted" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>{entry.inventoryItemId && <Link href={`/inventory/${encodeURIComponent(entry.inventoryItemId)}`}>Review listing</Link>}</article>)}
        <Link href="/settings/marketplaces">Check marketplace connections</Link>
      </div></details>}
    </div>
  </section>;
}

export function InventoryAttention({ token, onResolved }: { token: string; onResolved: () => void }) {
  const [tasks, setTasks] = useState<InventoryReviewTask[]>([]);
  const [notifications, setNotifications] = useState<InventoryNotification[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [choice, setChoice] = useState<{ task: InventoryReviewTask; status: "resolved" | "dismissed" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const results = await Promise.allSettled([api.getInventoryReviewTasks(token), api.getInventoryNotifications(token)]);
      if (!active) return;
      const failures: string[] = [];
      if (results[0].status === "fulfilled") setTasks(results[0].value.reviewTasks);
      else failures.push("Review tasks could not be refreshed. Try again before resolving a task.");
      if (results[1].status === "fulfilled") setNotifications(results[1].value.notifications);
      else failures.push("Recent updates could not be refreshed.");
      setErrors(failures); setLoading(false);
      timer = setTimeout(() => void load(), 30_000);
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [token, revision, refresh]);
  async function resolve() {
    if (!choice || busy) return;
    setBusy(true); setActionError("");
    try {
      await api.resolveInventoryReviewTask(token, choice.task.id, choice.status);
      setTasks((current) => current.filter((task) => task.id !== choice.task.id));
      setChoice(null); refresh(); onResolved();
    } catch (error) { setActionError((error as { error?: string })?.error ?? "Could not resolve this task. It remains open; refresh and try again."); }
    finally { setBusy(false); }
  }
  const action = choice ? reviewAction(choice.task) : null;
  return <>
    <InventoryAttentionView tasks={tasks} notifications={notifications} loading={loading} errors={errors} busy={busy} onRefresh={refresh} onReview={(task, status) => { setActionError(""); setChoice({ task, status }); }} />
    <Modal title={choice?.status === "dismissed" ? "Dismiss possible sale" : action?.label ?? "Review task"} open={Boolean(choice)} onClose={busy ? undefined : () => setChoice(null)}>
      <div className="modal__body stack-3"><p>{choice?.status === "dismissed" ? "Confirm this signal is not a sale. Sello will dismiss the task without marking the item sold." : action?.explanation}</p>{actionError && <p role="alert">{actionError}</p>}</div>
      <div className="modal__foot"><Btn disabled={busy} onClick={() => setChoice(null)}>Cancel</Btn><Btn disabled={busy} onClick={() => void resolve()}>{busy ? "Saving…" : choice?.status === "dismissed" ? "Not a sale" : action?.label}</Btn></div>
    </Modal>
  </>;
}
