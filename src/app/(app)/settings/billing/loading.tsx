import { Topbar } from "@/components/app/topbar";

export default function BillingLoading() {
  return (
    <>
      <Topbar crumbs={["Settings", "Billing"]} />

      <main className="page">
        <div className="page__head">
          <div className="page__title-row">
            <h1 className="page__title">
              Billing<em>.</em>
            </h1>
            <div className="page__title-meta">Plan, usage, and subscription controls</div>
          </div>
        </div>

        <div className="stack-4" style={{ display: "grid", gap: 20, maxWidth: 920 }}>
          <section className="card">
            <div className="card__head">
              <div className="skel" style={{ width: 112, height: 14 }} />
              <div className="skel" style={{ width: 78, height: 22, borderRadius: 999 }} />
            </div>
            <div className="card__body">
              <div className="row" style={{ justifyContent: "space-between", gap: 16 }}>
                <div>
                  <div className="skel" style={{ width: 42, height: 10, marginBottom: 10 }} />
                  <div className="skel" style={{ width: 132, height: 34 }} />
                </div>
                <div>
                  <div className="skel" style={{ width: 52, height: 10, marginBottom: 10 }} />
                  <div className="skel" style={{ width: 126, height: 18 }} />
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <div className="skel" style={{ width: 94, height: 14 }} />
            </div>
            <div className="card__body">
              <div style={{ display: "grid", gap: 18 }}>
                {[0, 1, 2].map((item) => (
                  <div key={item} className="usage-meter">
                    <div className="usage-meter__head">
                      <div className="skel" style={{ width: 110, height: 12 }} />
                      <div className="skel" style={{ width: 42, height: 12 }} />
                    </div>
                    <div className="skel" style={{ height: 6, borderRadius: 999 }} />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
