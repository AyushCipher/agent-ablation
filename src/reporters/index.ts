import type { BatchAblationSummary, RoiSummary } from "../index.js";

export interface ReportOptions {
  /** Title for the report */
  title?: string;
  /** Whether to include ROI breakdown table */
  includeRoi?: boolean;
  /** Whether to include pruning recommendations */
  includeRecommendations?: boolean;
}

/**
 * Formats batch ablation results and ROI metrics into a GitHub / Dev.to-flavored Markdown report.
 */
export function formatMarkdownReport(
  summary: BatchAblationSummary,
  options: ReportOptions = {}
): string {
  const title = options.title || "Agent Ablation & ROI Evaluation Report";
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- **Evaluated Cases:** ${summary.cases}`);
  lines.push(`- **Average Load-Bearing Ratio:** ${(summary.averageLoadBearingRatio * 100).toFixed(1)}%`);
  if (summary.accuracy !== undefined) {
    lines.push(`- **Baseline Accuracy:** ${(summary.accuracy.baselineAccuracy * 100).toFixed(1)}%`);
  }
  lines.push("");

  lines.push("### Per-Agent Influence Breakdown");
  lines.push("");
  lines.push("| Agent ID | Appearances | Verdict Flips | Influence Share | Net Accuracy Impact |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");

  const agentIds = Object.keys(summary.perAgentInfluence);
  for (const id of agentIds) {
    const influence = summary.perAgentInfluence[id] ?? 0;
    const stats = summary.perAgentStats?.[id];
    const appearances = stats?.appearances ?? "-";
    const flips = stats?.flips ?? "-";
    
    let netAccStr = "N/A";
    if (stats?.netAccuracyImpact !== undefined) {
      const sign = stats.netAccuracyImpact > 0 ? "+" : "";
      netAccStr = `${sign}${(stats.netAccuracyImpact * 100).toFixed(1)}% (${stats.role || "Neutral"})`;
    }

    lines.push(
      `| \`${id}\` | ${appearances} | ${flips} | ${(influence * 100).toFixed(1)}% | ${netAccStr} |`
    );
  }
  lines.push("");

  if (summary.roi && options.includeRoi !== false) {
    lines.push("### Cost & Telemetry ROI Analysis");
    lines.push("");
    lines.push("| Agent ID | Total Cost | Total Tokens | Cost / Verdict Flip | Cost Share | ROI Efficiency |");
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");

    for (const [id, agentRoi] of Object.entries(summary.roi.agents)) {
      const costStr = agentRoi.totalCost !== undefined ? `$${agentRoi.totalCost.toFixed(4)}` : "N/A";
      const tokenStr = agentRoi.totalTokens !== undefined ? agentRoi.totalTokens.toLocaleString() : "N/A";
      const costPerFlipStr = agentRoi.costPerVerdictFlip !== undefined ? `$${agentRoi.costPerVerdictFlip.toFixed(4)}` : "N/A";
      const costShareStr = agentRoi.costShare !== undefined ? `${(agentRoi.costShare * 100).toFixed(1)}%` : "N/A";
      const roiEffStr = agentRoi.efficiencyRatio !== undefined ? `${agentRoi.efficiencyRatio.toFixed(2)}x` : "N/A";

      lines.push(
        `| \`${id}\` | ${costStr} | ${tokenStr} | ${costPerFlipStr} | ${costShareStr} | ${roiEffStr} |`
      );
    }
    lines.push("");
  }

  if (summary.roi?.recommendations && summary.roi.recommendations.length > 0 && options.includeRecommendations !== false) {
    lines.push("### Optimization & Pruning Recommendations");
    lines.push("");
    for (const rec of summary.roi.recommendations) {
      lines.push(`- ⚠️ **\`${rec.agentId}\`**: ${rec.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Formats batch ablation results into an ASCII table string for CLI/terminal logs.
 */
export function formatAsciiTable(summary: BatchAblationSummary): string {
  const lines: string[] = [];
  lines.push("================ AGENT ABLATION SUMMARY ================");
  lines.push(`Cases: ${summary.cases} | Mean Load-Bearing Ratio: ${(summary.averageLoadBearingRatio * 100).toFixed(1)}%`);
  lines.push("--------------------------------------------------------");
  lines.push("Agent ID                | Flips | Influence | Cost/Flip");
  lines.push("--------------------------------------------------------");

  for (const [id, influence] of Object.entries(summary.perAgentInfluence)) {
    const paddedId = id.padEnd(23, " ").slice(0, 23);
    const stats = summary.perAgentStats?.[id];
    const flips = stats ? `${stats.flips}/${stats.appearances}`.padEnd(5, " ") : "N/A  ";
    const infStr = `${(influence * 100).toFixed(1)}%`.padEnd(9, " ");
    const agentRoi = summary.roi?.agents[id];
    const costPerFlip = agentRoi?.costPerVerdictFlip !== undefined ? `$${agentRoi.costPerVerdictFlip.toFixed(3)}` : "N/A";

    lines.push(`${paddedId} | ${flips} | ${infStr} | ${costPerFlip}`);
  }
  lines.push("========================================================");

  return lines.join("\n");
}
