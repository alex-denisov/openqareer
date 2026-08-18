import type { JobFitResult } from "../../services/jobFitAnalyzer";
import type { SkillGap, XyzBulletRecommendation } from "../../services/skillGapDiagnoser";

interface JobFitScreeningSectionProps {
  jobFitResult: JobFitResult;
  skillGaps: SkillGap[];
  xyzBullet: XyzBulletRecommendation;
}

// eslint-disable-next-line max-lines-per-function
export function JobFitScreeningSection({
  jobFitResult,
  skillGaps,
  xyzBullet,
}: JobFitScreeningSectionProps) {
  const isHighFit = jobFitResult.overallScore >= 75;

  return (
    <section className="career-market-watch" aria-labelledby="career-jobfit-title">
      <header>
        <div>
          <span>Job-Fit & Скрининг вакансии</span>
          <h3 id="career-jobfit-title">
            Индекс соответствия: {jobFitResult.overallScore}%
          </h3>
        </div>
        <span
          className={`career-search-status ${isHighFit ? "is-active" : "is-paused"}`}
          style={{
            background: isHighFit ? "oklch(75% 0.14 154 / 0.18)" : "oklch(79% 0.13 79 / 0.18)",
            color: isHighFit ? "var(--primary-success, #22c55e)" : "var(--warning-amber, #eab308)",
            padding: "4px 10px",
            borderRadius: "12px",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          {jobFitResult.overallScore >= 80 ? "Высокий Fit" : "Средний Fit"}
        </span>
      </header>

      <p style={{ fontSize: "13px", color: "var(--career-text-dim, #9ca3af)", margin: "8px 0 12px", lineHeight: 1.45 }}>
        {jobFitResult.verdict}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", margin: "12px 0" }}>
        <div style={{ padding: "8px 6px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px", textAlign: "center" }}>
          <small style={{ color: "var(--career-text-dim, #9ca3af)", display: "block", fontSize: "11px" }}>Hard Skills</small>
          <strong style={{ fontSize: "14px" }}>{jobFitResult.hardSkillsMatch.score}%</strong>
        </div>
        <div style={{ padding: "8px 6px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px", textAlign: "center" }}>
          <small style={{ color: "var(--career-text-dim, #9ca3af)", display: "block", fontSize: "11px" }}>Soft Skills</small>
          <strong style={{ fontSize: "14px" }}>{jobFitResult.softSkillsMatch.score}%</strong>
        </div>
        <div style={{ padding: "8px 6px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px", textAlign: "center" }}>
          <small style={{ color: "var(--career-text-dim, #9ca3af)", display: "block", fontSize: "11px" }}>Сеньорити</small>
          <strong style={{ fontSize: "14px" }}>{jobFitResult.seniorityMatch.score}%</strong>
        </div>
        <div style={{ padding: "8px 6px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px", textAlign: "center" }}>
          <small style={{ color: "var(--career-text-dim, #9ca3af)", display: "block", fontSize: "11px" }}>ATS Скоринг</small>
          <strong style={{ fontSize: "14px", color: "var(--primary-success, #22c55e)" }}>{jobFitResult.atsScore}%</strong>
        </div>
      </div>

      {skillGaps.length > 0 ? (
        <div style={{ margin: "12px 0", padding: "12px", background: "rgba(234, 179, 8, 0.08)", border: "1px solid rgba(234, 179, 8, 0.25)", borderRadius: "10px" }}>
          <strong style={{ display: "block", fontSize: "13px", color: "#eab308", marginBottom: "4px" }}>
            Пробелы в стеке (Skill Gaps):
          </strong>
          <ul style={{ margin: "0 0 8px 16px", padding: 0, fontSize: "12px", color: "var(--career-text-soft, #d1d5db)" }}>
            {skillGaps.slice(0, 3).map((gap, idx) => (
              <li key={idx} style={{ marginBottom: "2px" }}>
                <strong>{gap.skill}</strong> — {gap.recommendedAction}
              </li>
            ))}
          </ul>
          <div style={{ fontSize: "11px", color: "var(--career-text-dim, #9ca3af)", borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: "6px" }}>
            <strong>Рекомендация Google XYZ:</strong> {xyzBullet.formattedText}
          </div>
        </div>
      ) : null}
    </section>
  );
}
