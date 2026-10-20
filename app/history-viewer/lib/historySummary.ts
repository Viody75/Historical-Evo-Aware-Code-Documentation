import type {
  GeneratedIssueSummary,
  HistoricalExportPayload,
  HistoricalIssueEntry,
  SummaryChangeContrastEntry,
  SnapshotSummaryIndex,
  SummaryWhatChangedEntry,
} from "@/app/history-viewer/types";

function normalizeCommitId(commitId: string) {
  return commitId.trim().toLowerCase();
}

function buildCommitLookup(issue: HistoricalIssueEntry) {
  return new Map(
    issue.commits.map((commit) => [normalizeCommitId(commit.sha), commit.sha]),
  );
}

export function resolveCommitIdsForIssue(
  issue: HistoricalIssueEntry,
  relatedCommitIds: string[],
) {
  const commitLookup = buildCommitLookup(issue);
  const resolved = new Set<string>();

  for (const rawCommitId of relatedCommitIds) {
    const normalized = normalizeCommitId(rawCommitId);
    if (!normalized) {
      continue;
    }

    for (const [fullSha] of commitLookup.entries()) {
      if (fullSha.startsWith(normalized)) {
        resolved.add(commitLookup.get(fullSha) || normalized);
      }
    }
  }

  return [...resolved];
}

export function buildIssueRationaleMap(
  issue: HistoricalIssueEntry,
  issueSummary?: GeneratedIssueSummary | null,
) {
  const rationaleMap = new Map<string, SummaryWhatChangedEntry[]>();
  if (!issueSummary) {
    return rationaleMap;
  }

  for (const entry of issueSummary.whatChanged) {
    for (const resolvedCommitId of resolveCommitIdsForIssue(
      issue,
      entry.relatedCommitIds,
    )) {
      const existing = rationaleMap.get(resolvedCommitId) || [];
      rationaleMap.set(resolvedCommitId, [...existing, entry]);
    }
  }

  return rationaleMap;
}

export function buildSummaryIndexMap(summaryIndex: SnapshotSummaryIndex | null) {
  return new Map(
    (summaryIndex?.issues || []).map((issueSummary) => [
      issueSummary.issueNumber,
      issueSummary,
    ]),
  );
}

function renderList(items: string[]) {
  if (items.length === 0) {
    return "- None";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function renderImpactCell(items: string[]) {
  if (items.length === 0) {
    return "None";
  }

  return items.join("<br />");
}

export type StructuredRationale = {
  cause: string;
  effect: string;
  solution: string;
};

function cleanRationalePart(value: string) {
  return value.trim().replace(/^[,;:.\s]+|[,;:.\s]+$/g, "");
}

export function structureRationale(value?: string): StructuredRationale {
  const normalized = value?.trim() || "";
  if (!normalized || normalized === "-") {
    return { cause: "Not stated.", effect: "Not stated.", solution: "Not stated." };
  }

  const withoutCausePrefix = normalized.replace(/^(because|karena)\s+/i, "");
  const solutionMatch = withoutCausePrefix.match(/\b(?:solution|solusi)\s*:\s*/i);
  const beforeSolution = solutionMatch
    ? withoutCausePrefix.slice(0, solutionMatch.index)
    : withoutCausePrefix;
  const explicitSolution = solutionMatch
    ? withoutCausePrefix.slice((solutionMatch.index || 0) + solutionMatch[0].length)
    : "";
  const effectMatch = beforeSolution.match(
    /[,;.]?\s*\b(?:therefore|thus|so that|sehingga|maka|jadi)\b[,;:]?\s*/i,
  );
  const cause = cleanRationalePart(
    effectMatch ? beforeSolution.slice(0, effectMatch.index) : beforeSolution,
  );
  const effect = cleanRationalePart(
    effectMatch
      ? beforeSolution.slice((effectMatch.index || 0) + effectMatch[0].length)
      : "The available evidence does not state a distinct effect",
  );
  const solution = cleanRationalePart(
    explicitSolution ||
      "The implementation change described above addresses the reported issue",
  );

  return {
    cause: cause || "The cause was not stated",
    effect: effect || "The effect was not stated",
    solution: solution || "The solution was not stated",
  };
}

export function formatStructuredRationale(value?: string) {
  const rationale = structureRationale(value);
  return `Because ${rationale.cause}. Therefore, ${rationale.effect}. Solution: ${rationale.solution}.`;
}

function renderRationaleSections(value?: string) {
  const rationale = structureRationale(value);
  return `<strong>Cause:</strong> ${rationale.cause}<br /><strong>Effect:</strong> ${rationale.effect}<br /><strong>Solution:</strong> ${rationale.solution}`;
}

function renderWhatChangedRows(rows: SummaryWhatChangedEntry[]) {
  if (rows.length === 0) {
    return "| No notable changes captured | No rationale captured | - |";
  }

  return rows
    .map(
      (row) =>
        `| ${row.change.replaceAll("\n", " ")} | ${renderRationaleSections(row.rationale).replaceAll("\n", " ")}<br /><small>${row.evidenceSource}; refs: ${row.evidenceRefs.join(", ") || "-"}</small> | ${row.relatedCommitIds.join(", ")} |`,
    )
    .join("\n");
}

function renderChangeContrastRows(rows: SummaryChangeContrastEntry[]) {
  if (rows.length === 0) {
    return "| - | - | No contrast captured | No contrast captured | No rationale captured | - |";
  }

  return rows
    .map((row) => {
      const change = (row.change || row.aspect || "-").replaceAll("\n", " ");
      const significance = (row.significance || "-").replaceAll("\n", " ");
      const before = row.before.replaceAll("\n", " ");
      const after = row.after.replaceAll("\n", " ");
      const rationale = renderRationaleSections(
        row.rationale || row.reason || "-",
      ).replaceAll("\n", " ");
      const evidence = `${row.evidenceSource}; refs: ${row.evidenceRefs.join(", ") || "-"}; commits: ${row.relatedCommitIds.join(", ") || "-"}`.replaceAll(
        "\n",
        " ",
      );

      return `| ${change} | ${significance} | ${before} | ${after} | ${rationale} | ${evidence} |`;
    })
    .join("\n");
}

function renderImpactRows(issueSummary: Omit<GeneratedIssueSummary, "markdown">) {
  return [
    `| User | ${renderImpactCell(issueSummary.impact.user)} |`,
    `| System | ${renderImpactCell(issueSummary.impact.system)} |`,
    `| Developer | ${renderImpactCell(issueSummary.impact.developer)} |`,
  ].join("\n");
}

export function renderIssueSummaryMarkdown(
  template: string,
  issueSummary: Omit<GeneratedIssueSummary, "markdown">,
) {
  return template
    .replaceAll("{{title}}", issueSummary.title)
    .replaceAll("{{related_issue}}", issueSummary.relatedIssue || "-")
    .replaceAll("{{pull_request}}", issueSummary.pullRequest)
    .replaceAll("{{background}}", issueSummary.background)
    .replaceAll(
      "{{what_changed_rows}}",
      renderWhatChangedRows(issueSummary.whatChanged),
    )
    .replaceAll(
      "{{change_contrast_rows}}",
      renderChangeContrastRows(issueSummary.changeContrast || []),
    )
    .replaceAll(
      "{{change_size}}",
      issueSummary.changeSize
        ? `${issueSummary.changeSize.level} - ${formatStructuredRationale(issueSummary.changeSize.rationale)}`
        : "-",
    )
    .replaceAll("{{impact_rows}}", renderImpactRows(issueSummary))
    .replaceAll(
      "{{testing_verification}}",
      renderList(issueSummary.testingVerification),
    )
    .replaceAll("{{notes}}", renderList(issueSummary.notes));
}

export function summarizeIssueContext(payload: HistoricalExportPayload) {
  return payload.issues.map((issue) => ({
    issueNumber: issue.issueNumber,
    title: issue.title,
    commits: issue.commits.length,
  }));
}
