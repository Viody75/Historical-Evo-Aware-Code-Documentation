import {
  buildIssueRationaleMap,
  buildSummaryIndexMap,
} from "@/app/history-viewer/lib/historySummary";
import type {
  HistoryTreeNode,
  HistoricalExportPayload,
  HistoricalIssueEntry,
  SnapshotSummaryIndex,
} from "@/app/history-viewer/types";

function countCodeChanges(issue: HistoricalIssueEntry) {
  return issue.commits.reduce(
    (total, commit) => total + commit.codeChanges.length,
    0,
  );
}

export function truncateLabel(label: string, maxLength = 40) {
  if (label.length <= maxLength) {
    return label;
  }

  return `${label.slice(0, maxLength - 1)}...`;
}

function buildIssueTreeNode(
  issue: HistoricalIssueEntry,
  summaryIndex: SnapshotSummaryIndex | null,
): HistoryTreeNode {
  const issueSummary = buildSummaryIndexMap(summaryIndex).get(issue.issueNumber);
  const rationaleMap = buildIssueRationaleMap(issue, issueSummary);

  return {
    id: `issue-${issue.issueNumber}`,
    label: `#${issue.issueNumber} ${issue.title}`,
    kind: "issue",
    meta: `${issue.commits.length} commits • ${issue.discussion.length} discussions`,
    detail: issue.summary || "No summary captured in this snapshot.",
    target: {
      issueNumber: issue.issueNumber,
      filePath: issue.commits.flatMap((commit) => commit.codeChanges)[0]?.filename,
      label: issue.title,
    },
    children: [
      {
        id: `issue-${issue.issueNumber}-discussion`,
        label: "discussion",
        kind: "group",
        meta: `${issue.discussion.length} items`,
        children:
          issue.discussion.length > 0
            ? issue.discussion.map((entry) => ({
                id: `discussion-${entry.type}-${entry.id}`,
                label: `${entry.type === "issue_comment" ? "issueComment" : "reviewComment"}:${entry.author}`,
                kind: "discussion",
                meta: new Date(entry.createdAt).toLocaleDateString("id-ID"),
                detail: entry.body || "Empty comment body.",
                target: {
                  issueNumber: issue.issueNumber,
                  filePath: issue.commits.flatMap((commit) => commit.codeChanges)[0]
                    ?.filename,
                  label: entry.author,
                },
                children: [],
              }))
            : [
                {
                  id: `discussion-empty-${issue.issueNumber}`,
                  label: "empty",
                  kind: "discussion",
                  meta: "0 items",
                  detail: "No discussion items captured.",
                  children: [],
                },
              ],
      },
      {
        id: `issue-${issue.issueNumber}-commits`,
        label: "commits",
        kind: "group",
        meta: `${issue.commits.length} items`,
        children: issue.commits.map((commit) => {
          const commitRationales = rationaleMap.get(commit.sha) || [];

          return {
            id: `commit-${commit.sha}`,
            label: commit.message.split("\n")[0] || commit.sha,
            kind: "commit",
            meta: `${commit.sha.slice(0, 7)} • ${commit.codeChanges.length} files${
              commitRationales.length > 0
                ? ` • ${commitRationales.length} rationales`
                : ""
            }`,
            detail: `${commit.author}\n${new Date(commit.committedAt).toLocaleString("id-ID")}\n\n${commit.message}`,
            target: {
              issueNumber: issue.issueNumber,
              commitSha: commit.sha,
              filePath: commit.codeChanges[0]?.filename,
              label: commit.message,
            },
            children: [
              ...(commit.codeChanges.length > 0
                ? commit.codeChanges.map((change) => ({
                    id: `change-${commit.sha}-${change.filename}`,
                    label: change.filename,
                    kind: "change" as const,
                    meta: change.patch ? "patch available" : "empty patch",
                    detail: change.patch || "No patch text captured.",
                    target: {
                      issueNumber: issue.issueNumber,
                      commitSha: commit.sha,
                      filePath: change.filename,
                      label: change.filename,
                    },
                    children: [],
                  }))
                : [
                    {
                      id: `change-empty-${commit.sha}`,
                      label: "empty",
                      kind: "change" as const,
                      meta: "0 files",
                      detail: "No code changes captured.",
                      children: [],
                    },
                  ]),
              ...(commitRationales.length > 0
                ? [
                    {
                      id: `commit-${commit.sha}-rationales`,
                      label: "rationales",
                      kind: "group" as const,
                      meta: `${commitRationales.length} linked items`,
                      children: commitRationales.map((entry, index) => ({
                        id: `rationale-${commit.sha}-${index}`,
                        label: entry.change,
                        kind: "rationale" as const,
                        meta: `${entry.evidenceSource} • ${entry.relatedCommitIds.join(", ")}`,
                        detail: `${entry.rationale}\n\nEvidence refs:\n${entry.evidenceRefs.join("\n") || "-"}`,
                        target: {
                          issueNumber: issue.issueNumber,
                          commitSha: commit.sha,
                          filePath: commit.codeChanges[0]?.filename,
                          label: entry.change,
                        },
                        children: [],
                      })),
                    },
                  ]
                : []),
            ],
          };
        }),
      },
      {
        id: `issue-${issue.issueNumber}-summary`,
        label: "summary",
        kind: "group",
        meta: issueSummary
          ? `${countCodeChanges(issue)} code changes • generated summary`
          : `${countCodeChanges(issue)} code changes`,
        detail: issueSummary
          ? issueSummary.markdown
          : issue.url,
        children: [],
      },
    ],
  };
}

export function createHistoryTree(
  payload: HistoricalExportPayload,
  summaryIndex: SnapshotSummaryIndex | null = null,
): HistoryTreeNode {
  return {
    id: "root",
    label: payload.repo,
    kind: "root",
    meta: `${payload.issues.length} PR stories`,
    detail: payload.description,
    children: [
      {
        id: "issues",
        label: "issues",
        kind: "issues",
        meta: `${payload.issues.length} issue nodes`,
        children: payload.issues.map((issue) =>
          buildIssueTreeNode(issue, summaryIndex),
        ),
      },
    ],
  };
}

export function treeLabel(node: HistoryTreeNode) {
  return `${node.label} ${node.meta || ""} ${node.detail || ""}`.toLowerCase();
}

export function createInitialCollapsed(treeRoot: HistoryTreeNode) {
  const collapsed = new Set<string>();

  for (const section of treeRoot.children) {
    for (const issueNode of section.children) {
      collapsed.add(issueNode.id);
    }
  }

  return collapsed;
}

export function applyCollapsedState(
  node: HistoryTreeNode,
  collapsed: Set<string>,
): HistoryTreeNode {
  if (collapsed.has(node.id)) {
    return {
      ...node,
      children: [],
    };
  }

  return {
    ...node,
    children: node.children.map((child) =>
      applyCollapsedState(child, collapsed),
    ),
  };
}

export function collectNodeMap(
  node: HistoryTreeNode,
  parentId: string | null = null,
  map = new Map<string, HistoryTreeNode & { parentId: string | null }>(),
) {
  map.set(node.id, { ...node, parentId });
  for (const child of node.children) {
    collectNodeMap(child, node.id, map);
  }
  return map;
}
