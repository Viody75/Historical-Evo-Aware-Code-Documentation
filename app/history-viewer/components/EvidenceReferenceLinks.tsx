import type { ReactNode } from "react";

import type { HistoricalExportPayload } from "@/app/history-viewer/types";

function safeGitHubUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function repositoryUrl(repo: string) {
  const segments = repo.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return null;
  }

  return `https://github.com/${segments.map(encodeURIComponent).join("/")}`;
}

function findCommit(payload: HistoricalExportPayload, commitId: string) {
  const normalizedId = commitId.trim().toLowerCase();
  if (!normalizedId) {
    return null;
  }

  return (
    payload.issues
      .flatMap((issue) => issue.commits)
      .find((commit) => {
        const sha = commit.sha.toLowerCase();
        return sha.startsWith(normalizedId) || normalizedId.startsWith(sha);
      }) || null
  );
}

export function resolveEvidenceReferenceUrl(input: {
  reference: string;
  payload: HistoricalExportPayload;
  issueNumber?: number;
}) {
  const reference = input.reference.trim();
  const directUrl = safeGitHubUrl(reference);
  if (directUrl) {
    return directUrl;
  }

  const repoUrl = repositoryUrl(input.payload.repo);
  const [kind, identifier, ...remainder] = reference.split(":");

  if (kind === "summary" && identifier === "issue") {
    const summaryIssueNumber = Number(remainder[0]);
    const issue = input.payload.issues.find(
      (entry) => entry.issueNumber === summaryIssueNumber,
    );
    return (
      safeGitHubUrl(issue?.url) ||
      (repoUrl && Number.isInteger(summaryIssueNumber)
        ? `${repoUrl}/pull/${summaryIssueNumber}`
        : null)
    );
  }

  if (kind === "issue") {
    const referencedIssueNumber = Number(identifier);
    const issue = input.payload.issues.find(
      (entry) => entry.issueNumber === referencedIssueNumber,
    );
    return (
      safeGitHubUrl(issue?.url) ||
      (repoUrl && Number.isInteger(referencedIssueNumber)
        ? `${repoUrl}/pull/${referencedIssueNumber}`
        : null)
    );
  }

  if (kind === "issue_comment" || kind === "review_comment") {
    const discussion = input.payload.issues
      .flatMap((issue) => issue.discussion)
      .find(
        (entry) =>
          entry.type === kind && String(entry.id) === identifier,
      );
    const storedUrl = safeGitHubUrl(discussion?.url);
    if (storedUrl) {
      return storedUrl;
    }

    const issue = input.payload.issues.find(
      (entry) => entry.issueNumber === input.issueNumber,
    );
    const issueUrl = safeGitHubUrl(issue?.url);
    if (!issueUrl || !identifier) {
      return null;
    }

    return kind === "issue_comment"
      ? `${issueUrl}#issuecomment-${encodeURIComponent(identifier)}`
      : `${issueUrl}/files#discussion_r${encodeURIComponent(identifier)}`;
  }

  if (kind === "commit" || kind === "patch") {
    const commitId = identifier || "";
    const commit = findCommit(input.payload, commitId);
    return (
      safeGitHubUrl(commit?.url) ||
      (repoUrl && commitId
        ? `${repoUrl}/commit/${encodeURIComponent(commitId)}`
        : null)
    );
  }

  return null;
}

export function EvidenceReferenceLink({
  reference,
  payload,
  issueNumber,
  children,
}: {
  reference: string;
  payload: HistoricalExportPayload;
  issueNumber?: number;
  children?: ReactNode;
}) {
  const href = resolveEvidenceReferenceUrl({
    reference,
    payload,
    issueNumber,
  });
  const content = children || reference;
  const sharedClassName =
    "max-w-full break-all rounded-md border px-2 py-1 text-[11px] font-medium";

  if (!href) {
    return (
      <code className={`${sharedClassName} border-slate-200 bg-slate-50 text-slate-600`}>
        {content}
      </code>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${reference} on GitHub`}
      className={`${sharedClassName} inline-flex items-center gap-1 border-sky-200 bg-sky-50 text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 hover:text-sky-900`}
    >
      <span>{content}</span>
      <span aria-hidden="true">↗</span>
      <span className="sr-only"> (opens GitHub in a new tab)</span>
    </a>
  );
}

export function EvidenceReferenceLinks({
  references,
  payload,
  issueNumber,
  emptyLabel = "No evidence reference",
}: {
  references: string[];
  payload: HistoricalExportPayload;
  issueNumber?: number;
  emptyLabel?: string;
}) {
  const uniqueReferences = [
    ...new Set(references.map((reference) => reference.trim()).filter(Boolean)),
  ];

  if (uniqueReferences.length === 0) {
    return <span className="text-xs text-slate-400">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {uniqueReferences.map((reference) => (
        <EvidenceReferenceLink
          key={reference}
          reference={reference}
          payload={payload}
          issueNumber={issueNumber}
        />
      ))}
    </div>
  );
}
