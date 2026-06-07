import { Fragment, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { Btn } from "@/components/ui/primitives";

export function Topbar({ crumbs = [], right }: { crumbs?: string[]; right?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar__crumbs">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <Icon name="chevR" size={13} />}
            {i === crumbs.length - 1 ? <strong>{c}</strong> : <span>{c}</span>}
          </Fragment>
        ))}
      </div>
      <div className="topbar__actions">
        {right}
        <Btn variant="ghost" size="sm" icon="help" title="Help" />
        <Btn variant="ghost" size="sm" icon="bell" title="Notifications" />
      </div>
    </header>
  );
}
