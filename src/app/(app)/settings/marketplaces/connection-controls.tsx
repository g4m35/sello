"use client";

import { useState } from "react";
import { Modal, Btn } from "@/components/ui/primitives";

export function ConnectionControls({ name, busy, onDisconnect, onRecheck }: {
  name: string;
  busy: boolean;
  onDisconnect: () => Promise<void>;
  onRecheck?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="btn btn--secondary" disabled={busy} aria-label={`Manage ${name} connection`} onClick={() => setOpen(true)}>Manage</button>
    <Modal title={`Manage ${name}`} open={open} onClose={busy ? undefined : () => setOpen(false)}>
      <div className="modal__head">Manage {name}</div>
      <div className="modal__body">
        <p>Disconnect this account from Sello? You can reconnect it later.</p>
      </div>
      <div className="modal__foot">
        {onRecheck && <Btn disabled={busy} onClick={() => { onRecheck(); setOpen(false); }}>Recheck connection</Btn>}
        <Btn disabled={busy} onClick={() => setOpen(false)}>Cancel</Btn>
        <Btn className="danger" disabled={busy} onClick={async () => { await onDisconnect(); setOpen(false); }}>Disconnect {name}</Btn>
      </div>
    </Modal>
  </>;
}
