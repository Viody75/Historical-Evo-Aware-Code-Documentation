import type {
  GeneratedIssueSummary,
  HistoricalExportPayload,
  HistoricalIssueEntry,
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

function renderWhatChangedRows(rows: SummaryWhatChangedEntry[]) {
  if (rows.length === 0) {
    return "| No notable changes captured | No rationale captured | - |";
  }

  return rows
    .map(
      (row) =>
        `| ${row.change.replaceAll("\n", " ")} | ${row.rationale.replaceAll("\n", " ")} (${row.evidenceSource}; refs: ${row.evidenceRefs.join(", ") || "-"}) | ${row.relatedCommitIds.join(", ")} |`,
    )
    .join("\n");
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
    .replaceAll("{{impact_user}}", renderList(issueSummary.impact.user))
    .replaceAll("{{impact_system}}", renderList(issueSummary.impact.system))
    .replaceAll(
      "{{impact_developer}}",
      renderList(issueSummary.impact.developer),
    )
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
