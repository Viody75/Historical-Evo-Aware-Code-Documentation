import { IngestionWorkspaceStore } from "@/app/history-viewer/server/IngestionWorkspaceStore";
import {
  PostgresHistoryStore,
  type PostgresPersistResult,
} from "@/app/history-viewer/server/PostgresHistoryStore";
import { SnapshotSummaryService } from "@/app/history-viewer/server/SnapshotSummaryService";
import { SnapshotWorkspaceStore } from "@/app/history-viewer/server/SnapshotWorkspaceStore";
import type {
  Commit,
  CommitDetailsResponse,
  DiscussionComment,
  HistoricalIssueEntry,
  IngestionMode,
  IngestionRunRecord,
  Issue,
  PullRequestDetailsResponse,
  RepoIngestionManifest,
  SearchIssuesResponse,
  SnapshotAstArtifact,
  SnapshotSummaryIndex,
} from "@/app/history-viewer/types";

const DEFAULT_BATCH_SIZE = 3;
const MAX_BATCH_SIZE = 20;
const MAX_SCAN_PAGES = 10;

type TriggerInput = {
  repo: string;
  mode?: IngestionMode;
  batchSize?: number;
  branchRef?: string;
  issueNumber?: number;
  generateSummaries?: boolean;
  model?: string;
};

type SelectedIssues = {
  issues: Issue[];
  nextBackfillPage?: number;
  backfillHasMore?: boolean;
};

function normalizeBatchSize(value?: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(value || 0)));
}

function normalizeRepo(input: string) {
  const value = input.trim();
  if (!value) {
    throw new Error("Repository is required");
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    const parsed = new URL(value);
    if (parsed.hostname !== "github.com") {
      throw new Error("Only GitHub repository URLs are supported");
    }

    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo) {
      throw new Error("Invalid GitHub repository URL");
    }

    return `${owner}/${repo}`;
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(value)) {
    throw new Error("Repository must use owner/repo format");
  }

  return value;
}

function endpointFromUrl(githubUrl: string) {
  const parsed = new URL(githubUrl);
  return `${parsed.pathname}${parsed.search}`;
}

class GitHubServerClient {
  constructor(private readonly repo: string) {}

  async fetchJson<T>(endpoint: string, accept = "application/vnd.github+json") {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": "nextjs-github-history-analyzer",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`https://api.github.com${endpoint}`, {
      headers,
    });
    const rawBody = await response.text();
    const data = rawBody.trim() ? (JSON.parse(rawBody) as unknown) : null;

    if (!response.ok) {
      const message =
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
          ? data.message
          : response.statusText || "GitHub API request failed";
      throw new Error(message);
    }

    return data as T;
  }

  searchMergedPullRequests(page: number, perPage: number) {
    const query = [`repo:${this.repo}`, "is:pr", "is:merged"].join(" ");
    const params = new URLSearchParams({
      q: query,
      sort: "updated",
      order: "desc",
      per_page: String(perPage),
      page: String(page),
    });

    return this.fetchJson<SearchIssuesResponse>(
      `/search/issues?${params.toString()}`,
      "application/vnd.github.full+json",
    );
  }

  fetchIssue(issueNumber: number) {
    return this.fetchJson<Issue>(
      `/repos/${this.repo}/issues/${issueNumber}`,
      "application/vnd.github.full+json",
    );
  }

  fetchIssueComments(commentsUrl: string) {
    return this.fetchJson<DiscussionComment[]>(
      `${endpointFromUrl(commentsUrl)}?per_page=100`,
      "application/vnd.github.full+json",
    );
  }

  fetchReviewComments(issueNumber: number) {
    return this.fetchJson<DiscussionComment[]>(
      `/repos/${this.repo}/pulls/${issueNumber}/comments?per_page=100`,
      "application/vnd.github.full+json",
    );
  }

  fetchPullRequestCommits(issueNumber: number) {
    return this.fetchJson<Commit[]>(
      `/repos/${this.repo}/pulls/${issueNumber}/commits?per_page=100`,
    );
  }

  fetchPullRequestDetails(issueNumber: number) {
    return this.fetchJson<PullRequestDetailsResponse>(
      `/repos/${this.repo}/pulls/${issueNumber}`,
    );
  }

  fetchCommitDiff(commitSha: string) {
    return this.fetchJson<CommitDetailsResponse>(
      `/repos/${this.repo}/commits/${commitSha}`,
    );
  }
}

export class GitHubIngestionService {
  constructor(
    private readonly ingestionStore = new IngestionWorkspaceStore(),
    private readonly snapshotStore = new SnapshotWorkspaceStore(),
    private readonly summaryService = new SnapshotSummaryService(),
    private readonly postgresStore = new PostgresHistoryStore(),
  ) {}

  async run(input: TriggerInput) {
    const repo = normalizeRepo(input.repo);
    const mode = input.mode || (input.issueNumber ? "issue" : "backfill");
    const batchSize = normalizeBatchSize(input.batchSize);
    const startedAt = new Date().toISOString();
    const runId = `${repo.replace("/", "-")}-${startedAt.replace(/[:.]/g, "-")}`;
    const baseRun = {
      id: runId,
      repo,
      mode,
      status: "running",
      startedAt,
      batchSize,
      issueNumbers: [],
      generatedSummary: false,
    } satisfies IngestionRunRecord;

    let manifest = await this.ingestionStore.loadManifest(repo, batchSize);
    const previousSnapshotId = manifest.latestSnapshotId;

    try {
      const client = new GitHubServerClient(repo);
      const selected = await this.selectIssues({
        client,
        manifest,
        mode,
        batchSize,
        issueNumber: input.issueNumber,
      });
      const historicalIssues: HistoricalIssueEntry[] = [];

      for (const issue of selected.issues) {
        const historicalIssue = await this.buildHistoricalIssue(client, issue);
        if (historicalIssue) {
          historicalIssues.push(historicalIssue);
        }
      }

      const existingPayload = await this.ingestionStore.loadPayload(repo);
      const payload = this.ingestionStore.mergeIssues({
        payload: existingPayload,
        issues: historicalIssues,
      });
      const snapshot = await this.snapshotStore.createSnapshot({
        repoName: repo,
        requestedBranchRef: input.branchRef || "main",
        payload,
      });

      let generatedSummary = false;
      let message = `Processed ${historicalIssues.length} issue(s).`;
      let summaryIndex: SnapshotSummaryIndex | null = null;
      let ast: SnapshotAstArtifact | null = null;
      const openAiApiKey = process.env.OPENAI_API_KEY;
      if (input.generateSummaries !== false && openAiApiKey) {
        try {
          const previousArtifacts = previousSnapshotId
            ? await this.snapshotStore.getSnapshotSummaryArtifacts(
                previousSnapshotId,
              )
            : { index: null, ast: null };
          const artifacts = await this.summaryService.generateArtifacts({
            apiKey: openAiApiKey,
            payload,
            model: input.model,
            previousIndex: previousArtifacts.index,
          });
          await this.snapshotStore.saveSnapshotSummaryArtifacts(
            snapshot.id,
            artifacts,
          );
          summaryIndex = artifacts.index;
          ast = artifacts.ast;
          generatedSummary = true;
          const reusedSummaryCount = artifacts.index.issues.filter(
            (issue) => issue.reusedFromGeneratedAt,
          ).length;
          const generatedSummaryCount =
            artifacts.index.issues.length - reusedSummaryCount;
          message = `${message} Generated ${generatedSummaryCount} summary item(s), reused ${reusedSummaryCount}.`;
        } catch (error) {
          const summaryError =
            error instanceof Error
              ? error.message
              : "Summary generation failed";
          message = `${message} Summary generation failed and can be retried later: ${summaryError}`;
        }
      } else if (input.generateSummaries !== false) {
        message = `${message} Summary generation skipped because OPENAI_API_KEY is not configured.`;
      }

      const completedRun = {
        ...baseRun,
        status: "completed",
        completedAt: new Date().toISOString(),
        issueNumbers: historicalIssues.map((issue) => issue.issueNumber),
        snapshotId: snapshot.id,
        generatedSummary,
        message,
      } satisfies IngestionRunRecord;

      manifest = this.ingestionStore.updateManifest({
        manifest,
        run: completedRun,
        processedIssues: historicalIssues,
        latestSnapshotId: snapshot.id,
        nextBackfillPage:
          mode === "backfill" ? selected.nextBackfillPage : undefined,
        backfillHasMore:
          mode === "backfill" ? selected.backfillHasMore : undefined,
      });
      await this.ingestionStore.saveWorkspace({ repo, manifest, payload });

      let database: PostgresPersistResult = {
        persisted: false,
        reason: "DATABASE_URL is not configured",
      };
      try {
        database = await this.postgresStore.persistIngestionResult({
          payload,
          snapshot,
          run: completedRun,
          summaryIndex,
          ast,
        });
      } catch (error) {
        database = {
          persisted: false,
          reason:
            error instanceof Error
              ? error.message
              : "Failed to persist ingestion result to Postgres",
        };
        completedRun.message = `${completedRun.message || message} Database persistence failed and can be retried later: ${database.reason}`;
      }

      return {
        ok: true,
        run: completedRun,
        manifest,
        snapshot,
        database,
      };
    } catch (error) {
      const failedRun = {
        ...baseRun,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Ingestion failed",
      } satisfies IngestionRunRecord;
      manifest = this.ingestionStore.updateManifest({
        manifest,
        run: failedRun,
        processedIssues: [],
      });
      const payload = await this.ingestionStore.loadPayload(repo);
      await this.ingestionStore.saveWorkspace({ repo, manifest, payload });
      throw error;
    }
  }

  private async selectIssues(input: {
    client: GitHubServerClient;
    manifest: RepoIngestionManifest;
    mode: IngestionMode;
    batchSize: number;
    issueNumber?: number;
  }): Promise<SelectedIssues> {
    if (input.mode === "issue") {
      if (!input.issueNumber) {
        throw new Error("issueNumber is required for issue mode");
      }

      return { issues: [await input.client.fetchIssue(input.issueNumber)] };
    }

    const processed = new Set(input.manifest.processedIssueNumbers);
    const selected: Issue[] = [];
    let page = input.mode === "backfill" ? input.manifest.backfill.page : 1;
    let hasMore = true;
    let pagesScanned = 0;

    while (
      selected.length < input.batchSize &&
      hasMore &&
      pagesScanned < MAX_SCAN_PAGES
    ) {
      const data = await input.client.searchMergedPullRequests(
        page,
        input.batchSize,
      );
      hasMore = data.items.length === input.batchSize;

      for (const issue of data.items) {
        if (!processed.has(issue.number)) {
          selected.push(issue);
        }

        if (selected.length >= input.batchSize) {
          break;
        }
      }

      page += 1;
      pagesScanned += 1;
    }

    return {
      issues: selected,
      nextBackfillPage: page,
      backfillHasMore: hasMore,
    };
  }

  private async buildHistoricalIssue(
    client: GitHubServerClient,
    issue: Issue,
  ): Promise<HistoricalIssueEntry | null> {
    if (!issue.pull_request) {
      return null;
    }

    const [comments, reviewComments, commits, pullRequest] = await Promise.all([
      client.fetchIssueComments(issue.comments_url),
      client.fetchReviewComments(issue.number),
      client.fetchPullRequestCommits(issue.number),
      client.fetchPullRequestDetails(issue.number),
    ]);

    if (!pullRequest.merged_at) {
      return null;
    }

    const historicalCommits = await Promise.all(
      commits.map(async (commit) => {
        const diff = await client.fetchCommitDiff(commit.sha);

        return {
          sha: commit.sha,
          message: commit.commit.message,
          author: commit.commit.author.name,
          committedAt: commit.commit.author.date,
          url: commit.html_url,
          codeChanges:
            diff.files?.map((file) => ({
              filename: file.filename,
              patch: file.patch || "",
            })) || [],
        };
      }),
    );

    if (historicalCommits.length === 0) {
      return null;
    }

    const discussion = [
      ...comments.map((comment) => ({
        id: comment.id,
        type: "issue_comment" as const,
        author: comment.user.login,
        createdAt: comment.created_at,
        url: comment.html_url,
        body: comment.body,
      })),
      ...reviewComments.map((comment) => ({
        id: comment.id,
        type: "review_comment" as const,
        author: comment.user.login,
        createdAt: comment.created_at,
        url: comment.html_url,
        body: comment.body,
      })),
    ].sort(
      (left, right) =>
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime(),
    );

    return {
      issueNumber: issue.number,
      title: issue.title,
      url: issue.html_url,
      createdAt: issue.created_at,
      summary: issue.body,
      discussion,
      commits: historicalCommits,
    };
  }
}
