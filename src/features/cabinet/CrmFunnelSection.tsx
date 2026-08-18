import { calculateFunnelMetrics, type CandidateApplication } from "../../services/applicationCrm";

interface CrmFunnelSectionProps {
  applications: CandidateApplication[];
}

// eslint-disable-next-line max-lines-per-function
export function CrmFunnelSection({ applications }: CrmFunnelSectionProps) {
  const metrics = calculateFunnelMetrics(applications);

  return (
    <section className="career-market-watch" aria-labelledby="career-crm-title">
      <header>
        <div>
          <span>Воронка откликов (CRM)</span>
          <h3 id="career-crm-title">
            {metrics.totalSent} откликов отправлено
          </h3>
        </div>
        <span className="career-search-status is-active">
          Просмотры {metrics.viewRate}%
        </span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", margin: "12px 0" }}>
        <div style={{ padding: "10px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px", textAlign: "center" }}>
          <small style={{ color: "var(--career-text-dim, #9ca3af)", display: "block" }}>Просмотрено</small>
          <strong style={{ fontSize: "16px" }}>{metrics.viewedCount}</strong>
        </div>
        <div style={{ padding: "10px", background: "rgba(34, 197, 94, 0.1)", borderRadius: "8px", textAlign: "center" }}>
          <small style={{ color: "var(--career-text-dim, #9ca3af)", display: "block" }}>Интервью</small>
          <strong style={{ fontSize: "16px", color: "var(--primary-success, #22c55e)" }}>{metrics.invitedCount}</strong>
        </div>
        <div style={{ padding: "10px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px", textAlign: "center" }}>
          <small style={{ color: "var(--career-text-dim, #9ca3af)", display: "block" }}>Конверсия</small>
          <strong style={{ fontSize: "16px" }}>{metrics.interviewRate}%</strong>
        </div>
      </div>

      <div className="career-cabinet-vacancies">
        {applications.map((app) => (
          <div
            key={app.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: "rgba(255, 255, 255, 0.03)",
              borderRadius: "8px",
              marginBottom: "6px",
            }}
          >
            <div>
              <strong style={{ fontSize: "14px", display: "block" }}>{app.vacancyTitle}</strong>
              <small style={{ color: "var(--career-text-dim, #9ca3af)" }}>{app.company} · {app.platform}.ru</small>
            </div>
            <span
              style={{
                fontSize: "12px",
                padding: "3px 8px",
                borderRadius: "12px",
                background: app.status === "invited" ? "rgba(34, 197, 94, 0.2)" : "rgba(56, 189, 248, 0.2)",
                color: app.status === "invited" ? "var(--primary-success, #22c55e)" : "var(--primary-accent, #38bdf8)",
              }}
            >
              {app.status === "sent" ? "Отправлен" : app.status === "viewed" ? "Просмотрен" : app.status === "invited" ? "Интервью" : "Отказ"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
