import type {
  HistoricalExportPayload,
  RagDocumentInput,
  RagDocumentKind,
  SnapshotSummaryIndex,
} from "@/app/history-viewer/types";

const MAX_CHUNK_CHARACTERS = 4_000;
const CHUNK_OVERLAP_CHARACTERS = 400;

type SourceDocument = Omit<RagDocumentInput, "id" | "content"> & {
  sourceId: string;
  content: string;
};

function normalizeText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function chunkText(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  if (normalized.length <= MAX_CHUNK_CHARACTERS) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const maximumEnd = Math.min(start + MAX_CHUNK_CHARACTERS, normalized.length);
    let end = maximumEnd;

    if (maximumEnd < normalized.length) {
      const paragraphBoundary = normalized.lastIndexOf("\n\n", maximumEnd);
      const lineBoundary = normalized.lastIndexOf("\n", maximumEnd);
      const preferredBoundary = Math.max(paragraphBoundary, lineBoundary);

      if (preferredBoundary > start + MAX_CHUNK_CHARACTERS / 2) {
        end = preferredBoundary;
      }
    }

    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP_CHARACTERS, start + 1);
  }

  return chunks.filter(Boolean);
}

function buildChunkedDocuments(
  snapshotId: string,
  source: SourceDocument,
): RagDocumentInput[] {
  return chunkText(source.content).map((content, chunkIndex, chunks) => ({
    id: `${snapshotId}:${source.kind}:${source.sourceId}:chunk-${chunkIndex + 1}`,
    kind: source.kind,
    issueNumber: source.issueNumber,
    commitSha: source.commitSha,
    filename: source.filename,
    title:
      chunks.length > 1
        ? `${source.title} (part ${chunkIndex + 1}/${chunks.length})`
        : source.title,
    content,
    evidenceRefs: source.evidenceRefs,
    metadata: {
      ...source.metadata,
      chunkIndex,
      chunkCount: chunks.length,
    },
  }));
}

function source(input: {
  kind: RagDocumentKind;
  sourceId: string;
  issueNumber?: number | null;
  commitSha?: string | null;
  filename?: string | null;
  title: string;
  content: string;
  evidenceRefs: string[];
  metadata?: Record<string, unknown>;
}): SourceDocument {
  return {
    kind: input.kind,
    sourceId: input.sourceId,
    issueNumber: input.issueNumber ?? null,
    commitSha: input.commitSha ?? null,
    filename: input.filename ?? null,
    title: input.title,
    content: input.content,
    evidenceRefs: input.evidenceRefs,
    metadata: input.metadata || {},
  };
}

export function buildRagDocuments(input: {
  snapshotId: string;
  payload: HistoricalExportPayload;
  summaryIndex?: SnapshotSummaryIndex | null;
}) {
  const sources: SourceDocument[] = [];
  const summaryByIssue = new Map(
    (input.summaryIndex?.issues || []).map((summary) => [
      summary.issueNumber,
      summary,
    ]),
  );

  for (const issue of input.payload.issues) {
    sources.push(
      source({
        kind: "issue",
        sourceId: String(issue.issueNumber),
        issueNumber: issue.issueNumber,
        title: `PR #${issue.issueNumber}: ${issue.title}`,
        content: [issue.title, issue.summary || ""].filter(Boolean).join("\n\n"),
        evidenceRefs: [`issue:${issue.issueNumber}`],
        metadata: {
          issueUrl: issue.url,
          createdAt: issue.createdAt,
        },
      }),
    );

    for (const discussion of issue.discussion) {
      const discussionRef = `${discussion.type}:${discussion.id}`;
      sources.push(
        source({
          kind: "discussion",
          sourceId: discussionRef,
          issueNumber: issue.issueNumber,
          title: `${discussion.type} by ${discussion.author} on PR #${issue.issueNumber}`,
          content: discussion.body,
          evidenceRefs: [discussionRef],
          metadata: {
            author: discussion.author,
            createdAt: discussion.createdAt,
            url: discussion.url || null,
          },
        }),
      );
    }

    for (const commit of issue.commits) {
      sources.push(
        source({
          kind: "commit",
          sourceId: commit.sha,
          issueNumber: issue.issueNumber,
          commitSha: commit.sha,
          title: `Commit ${commit.sha.slice(0, 7)}: ${commit.message.split("\n")[0]}`,
          content: [
            commit.message,
            `Author: ${commit.author}`,
            `Committed at: ${commit.committedAt}`,
          ].join("\n\n"),
          evidenceRefs: [`commit:${commit.sha}`],
          metadata: {
            author: commit.author,
            committedAt: commit.committedAt,
            url: commit.url,
          },
        }),
      );

      for (const change of commit.codeChanges) {
        const patchRef = `patch:${commit.sha}:${change.filename}`;
        sources.push(
          source({
            kind: "patch",
            sourceId: `${commit.sha}:${change.filename}`,
            issueNumber: issue.issueNumber,
            commitSha: commit.sha,
            filename: change.filename,
            title: `${change.filename} changed in ${commit.sha.slice(0, 7)} for PR #${issue.issueNumber}`,
            content: [
              `File: ${change.filename}`,
              `Commit: ${commit.sha}`,
              `Commit message: ${commit.message}`,
              change.patch,
            ].join("\n\n"),
            evidenceRefs: [patchRef, `commit:${commit.sha}`],
            metadata: {
              issueNumber: issue.issueNumber,
            },
          }),
        );
      }
    }

    const issueSummary = summaryByIssue.get(issue.issueNumber);
    if (issueSummary) {
      const evidenceRefs = new Set<string>([`summary:issue:${issue.issueNumber}`]);
      for (const entry of [
        ...issueSummary.whatChanged,
        ...(issueSummary.changeContrast || []),
      ]) {
        for (const evidenceRef of entry.evidenceRefs) {
          evidenceRefs.add(evidenceRef);
        }
      }

      sources.push(
        source({
          kind: "summary",
          sourceId: String(issue.issueNumber),
          issueNumber: issue.issueNumber,
          title: `Generated summary for PR #${issue.issueNumber}: ${issue.title}`,
          content: issueSummary.markdown,
          evidenceRefs: [...evidenceRefs],
          metadata: {
            generatedAt: issueSummary.generatedAt,
            model: issueSummary.model,
            sourceFingerprint: issueSummary.sourceFingerprint || null,
          },
        }),
      );
    }
  }

  return sources.flatMap((entry) =>
    buildChunkedDocuments(input.snapshotId, entry),
  );
}
