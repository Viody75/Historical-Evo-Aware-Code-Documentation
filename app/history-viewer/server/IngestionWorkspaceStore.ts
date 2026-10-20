import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  HistoricalExportPayload,
  HistoricalIssueEntry,
  IngestionRunRecord,
  RepoIngestionManifest,
} from "@/app/history-viewer/types";

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
}

function createEmptyPayload(repo: string): HistoricalExportPayload {
  return {
    repo,
    fetchedAt: new Date().toISOString(),
    exportType: "historical-evolution",
    description:
      "Incrementally collected repository history focused on linked discussions, commits, and code changes.",
    issues: [],
  };
}

function createManifest(repo: string, batchSize: number): RepoIngestionManifest {
  const now = new Date().toISOString();

  return {
    repo,
    createdAt: now,
    updatedAt: now,
    batchSize,
    processedIssueNumbers: [],
    totalIssues: 0,
    backfill: {
      page: 1,
      hasMore: true,
    },
    forward: {
      lastMergedAt: null,
    },
    runs: [],
  };
}

export class IngestionWorkspaceStore {
  constructor(
    private readonly rootDir = path.join(
      process.cwd(),
      "storage",
      "repo-ingestion",
    ),
  ) {}

  getWorkspaceDir(repo: string) {
    return path.join(this.rootDir, sanitizeSegment(repo));
  }

  getManifestPath(repo: string) {
    return path.join(this.getWorkspaceDir(repo), "manifest.json");
  }

  getHistoryPath(repo: string) {
    return path.join(this.getWorkspaceDir(repo), "history.json");
  }

  async loadManifest(repo: string, batchSize: number) {
    await mkdir(this.getWorkspaceDir(repo), { recursive: true });

    try {
      const raw = await readFile(this.getManifestPath(repo), "utf8");
      return JSON.parse(raw) as RepoIngestionManifest;
    } catch {
      return createManifest(repo, batchSize);
    }
  }

  async loadPayload(repo: string) {
    await mkdir(this.getWorkspaceDir(repo), { recursive: true });

    try {
      const raw = await readFile(this.getHistoryPath(repo), "utf8");
      return JSON.parse(raw) as HistoricalExportPayload;
    } catch {
      return createEmptyPayload(repo);
    }
  }

  async saveWorkspace(input: {
    repo: string;
    manifest: RepoIngestionManifest;
    payload: HistoricalExportPayload;
  }) {
    const workspaceDir = this.getWorkspaceDir(input.repo);
    await mkdir(workspaceDir, { recursive: true });

    await Promise.all([
      writeFile(
        this.getManifestPath(input.repo),
        JSON.stringify(input.manifest, null, 2),
        "utf8",
      ),
      writeFile(
        this.getHistoryPath(input.repo),
        JSON.stringify(input.payload, null, 2),
        "utf8",
      ),
    ]);
  }

  mergeIssues(input: {
    payload: HistoricalExportPayload;
    issues: HistoricalIssueEntry[];
  }) {
    const byIssueNumber = new Map(
      input.payload.issues.map((issue) => [issue.issueNumber, issue]),
    );

    for (const issue of input.issues) {
      byIssueNumber.set(issue.issueNumber, issue);
    }

    return {
      ...input.payload,
      fetchedAt: new Date().toISOString(),
      issues: [...byIssueNumber.values()].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      ),
    };
  }

  updateManifest(input: {
    manifest: RepoIngestionManifest;
    run: IngestionRunRecord;
    processedIssues: HistoricalIssueEntry[];
    latestSnapshotId?: string;
    nextBackfillPage?: number;
    backfillHasMore?: boolean;
  }) {
    const processedIssueNumbers = new Set(
      input.manifest.processedIssueNumbers,
    );

    for (const issue of input.processedIssues) {
      processedIssueNumbers.add(issue.issueNumber);
    }

    const sortedIssues = [...input.processedIssues].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );

    return {
      ...input.manifest,
      updatedAt: new Date().toISOString(),
      processedIssueNumbers: [...processedIssueNumbers].sort((left, right) =>
        left - right,
      ),
      totalIssues: processedIssueNumbers.size,
      latestSnapshotId:
        input.latestSnapshotId || input.manifest.latestSnapshotId,
      backfill: {
        page: input.nextBackfillPage ?? input.manifest.backfill.page,
        hasMore: input.backfillHasMore ?? input.manifest.backfill.hasMore,
      },
      forward: {
        lastMergedAt:
          sortedIssues[0]?.createdAt || input.manifest.forward.lastMergedAt,
      },
      runs: [input.run, ...input.manifest.runs].slice(0, 50),
    } satisfies RepoIngestionManifest;
  }
}
