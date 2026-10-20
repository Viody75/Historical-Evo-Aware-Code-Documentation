import { Pool, type PoolClient } from "pg";

import type {
  HistoricalExportPayload,
  IngestionRunRecord,
  SnapshotAstArtifact,
  SnapshotRecord,
  SnapshotSummaryIndex,
  StoredSummarySignificanceFlag,
} from "@/app/history-viewer/types";

let sharedPool: Pool | null = null;

export type PostgresPersistResult = {
  persisted: boolean;
  reason?: string;
};

export type ExtensionHistoryTrailItem = {
  repo: string;
  snapshotId: string | null;
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  commitSha: string;
  commitMessage: string;
  author: string;
  committedAt: string;
  filename: string;
  patch: string;
  summary: {
    generatedAt: string | null;
    sourceLastCommitAt: string | null;
    reusedFromGeneratedAt: string | null;
  } | null;
  rationales: Array<{
    change: string;
    rationale: string;
    evidenceSource: string;
    evidenceRefs: string[];
    relatedCommitIds: string[];
  }>;
  changeContrast: Array<{
    change: string;
    significance: string;
    group: string | null;
    before: string;
    after: string;
    rationale: string;
    evidenceSource: string;
    evidenceRefs: string[];
    relatedCommitIds: string[];
  }>;
  significanceFlags: Array<{
    change: string;
    significance: string;
    group: string;
    reason: string;
    evidenceSource: string;
    evidenceRefs: string[];
    relatedCommitIds: string[];
  }>;
};

function getDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || "";
}

function shouldUseSsl(databaseUrl: string) {
  return !/localhost|127\.0\.0\.1/.test(databaseUrl);
}

function getPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl(databaseUrl)
        ? {
            rejectUnauthorized: false,
          }
        : undefined,
    });
  }

  return sharedPool;
}

async function withTransaction<T>(
  client: PoolClient,
  callback: () => Promise<T>,
) {
  await client.query("begin");
  try {
    const result = await callback();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export class PostgresHistoryStore {
  isConfigured() {
    return Boolean(getDatabaseUrl());
  }

  async ensureSchema() {
    const pool = getPool();
    if (!pool) {
      return false;
    }

    await pool.query(`
      create table if not exists repositories (
        id bigserial primary key,
        full_name text not null unique,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists snapshots (
        id text primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        requested_branch_ref text not null,
        stored_branch_ref text not null,
        created_at timestamptz not null,
        snapshot_dir text not null,
        history_file text not null,
        repo_dir text not null,
        raw jsonb not null
      );

      create table if not exists ingestion_runs (
        id text primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        mode text not null,
        status text not null,
        started_at timestamptz not null,
        completed_at timestamptz,
        batch_size integer not null,
        issue_numbers integer[] not null default '{}',
        snapshot_id text references snapshots(id) on delete set null,
        generated_summary boolean not null default false,
        message text,
        error text,
        raw jsonb not null
      );

      create table if not exists issues (
        id bigserial primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        issue_number integer not null,
        snapshot_id text references snapshots(id) on delete set null,
        title text not null,
        url text not null,
        created_at timestamptz not null,
        summary text,
        raw jsonb not null,
        unique (repo_id, issue_number)
      );

      create table if not exists discussion_entries (
        id bigserial primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        issue_number integer not null,
        github_id bigint not null,
        type text not null,
        author text not null,
        created_at timestamptz not null,
        url text,
        body text not null,
        raw jsonb not null,
        unique (repo_id, issue_number, type, github_id)
      );

      create table if not exists commits (
        id bigserial primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        sha text not null,
        message text not null,
        author text not null,
        committed_at timestamptz not null,
        url text not null,
        raw jsonb not null,
        unique (repo_id, sha)
      );

      create table if not exists issue_commits (
        repo_id bigint not null references repositories(id) on delete cascade,
        issue_number integer not null,
        commit_sha text not null,
        primary key (repo_id, issue_number, commit_sha)
      );

      create table if not exists code_changes (
        id bigserial primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        commit_sha text not null,
        filename text not null,
        patch text not null,
        raw jsonb not null,
        unique (repo_id, commit_sha, filename)
      );

      create table if not exists issue_summaries (
        id bigserial primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        issue_number integer not null,
        snapshot_id text references snapshots(id) on delete cascade,
        title text not null,
        related_issue text,
        pull_request text not null,
        background text not null,
        markdown text not null,
        markdown_file text not null,
        generated_at timestamptz not null,
        model text not null,
        change_size_level text,
        change_size_rationale text,
        source_last_commit_at timestamptz,
        source_fingerprint text,
        reused_from_generated_at timestamptz,
        raw jsonb not null,
        unique (repo_id, issue_number, snapshot_id)
      );

      create table if not exists summary_what_changed (
        id bigserial primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        issue_number integer not null,
        snapshot_id text references snapshots(id) on delete cascade,
        change text not null,
        rationale text not null,
        related_commit_ids text[] not null default '{}',
        evidence_refs text[] not null default '{}',
        evidence_source text not null,
        raw jsonb not null
      );

      create table if not exists summary_change_contrast (
        id bigserial primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        issue_number integer not null,
        snapshot_id text references snapshots(id) on delete cascade,
        change text not null,
        significance text not null,
        change_group text,
        before_text text not null,
        after_text text not null,
        rationale text not null,
        related_commit_ids text[] not null default '{}',
        evidence_refs text[] not null default '{}',
        evidence_source text not null,
        raw jsonb not null
      );

      create table if not exists summary_significance_flags (
        id bigserial primary key,
        repo_id bigint not null references repositories(id) on delete cascade,
        issue_number integer not null,
        snapshot_id text references snapshots(id) on delete cascade,
        change text not null,
        significance text not null,
        change_group text not null,
        reason text not null,
        related_commit_ids text[] not null default '{}',
        evidence_refs text[] not null default '{}',
        evidence_source text not null,
        raw jsonb not null
      );

      create table if not exists snapshot_ast_artifacts (
        snapshot_id text primary key references snapshots(id) on delete cascade,
        repo_id bigint not null references repositories(id) on delete cascade,
        generated_at timestamptz not null,
        tree jsonb not null
      );

      alter table summary_change_contrast
        add column if not exists change_group text;
      alter table issue_summaries
        add column if not exists source_last_commit_at timestamptz;
      alter table issue_summaries
        add column if not exists source_fingerprint text;
      alter table issue_summaries
        add column if not exists reused_from_generated_at timestamptz;

      create index if not exists issues_repo_issue_idx
        on issues (repo_id, issue_number);
      create index if not exists commits_repo_sha_idx
        on commits (repo_id, sha);
      create index if not exists code_changes_repo_filename_idx
        on code_changes (repo_id, filename);
      create index if not exists summary_what_changed_repo_issue_idx
        on summary_what_changed (repo_id, issue_number);
      create index if not exists summary_change_contrast_repo_issue_idx
        on summary_change_contrast (repo_id, issue_number);
      create index if not exists summary_significance_flags_repo_issue_idx
        on summary_significance_flags (repo_id, issue_number);
      create index if not exists summary_significance_flags_significance_idx
        on summary_significance_flags (repo_id, significance, change_group);
      create index if not exists issue_summaries_source_commit_idx
        on issue_summaries (repo_id, source_last_commit_at);
    `);

    return true;
  }

  async persistIngestionResult(input: {
    payload: HistoricalExportPayload;
    snapshot: SnapshotRecord;
    run: IngestionRunRecord;
    summaryIndex?: SnapshotSummaryIndex | null;
    ast?: SnapshotAstArtifact | null;
  }) {
    const pool = getPool();
    if (!pool) {
      return { persisted: false, reason: "DATABASE_URL is not configured" };
    }

    await this.ensureSchema();

    const client = await pool.connect();
    try {
      await withTransaction(client, async () => {
        const repoId = await this.upsertRepository(client, input.payload.repo);
        await this.upsertSnapshot(client, repoId, input.snapshot);
        await this.upsertRun(client, repoId, input.run);
        await this.upsertHistoricalPayload(client, repoId, input);

        if (input.summaryIndex) {
          await this.upsertSummaryIndex(
            client,
            repoId,
            input.snapshot.id,
            input.summaryIndex,
          );
        }

        if (input.ast) {
          await this.upsertAst(client, repoId, input.snapshot.id, input.ast);
        }
      });

      return { persisted: true };
    } finally {
      client.release();
    }
  }

  async listSignificanceFlags(input: {
    repo?: string;
    snapshotId?: string;
    issueNumber?: number;
    limit?: number;
  }): Promise<StoredSummarySignificanceFlag[]> {
    const pool = getPool();
    if (!pool) {
      return [];
    }

    await this.ensureSchema();

    const conditions: string[] = [];
    const values: Array<string | number> = [];

    if (input.repo) {
      values.push(input.repo);
      conditions.push(`r.full_name = $${values.length}`);
    }

    if (input.snapshotId) {
      values.push(input.snapshotId);
      conditions.push(`f.snapshot_id = $${values.length}`);
    }

    if (input.issueNumber) {
      values.push(input.issueNumber);
      conditions.push(`f.issue_number = $${values.length}`);
    }

    const limit = Math.min(Math.max(input.limit || 200, 1), 1_000);
    values.push(limit);

    const result = await pool.query<{
      repo: string;
      issueNumber: number;
      snapshotId: string | null;
      change: StoredSummarySignificanceFlag["change"];
      significance: StoredSummarySignificanceFlag["significance"];
      group: StoredSummarySignificanceFlag["group"];
      reason: string;
      relatedCommitIds: string[];
      evidenceRefs: string[];
      evidenceSource: StoredSummarySignificanceFlag["evidenceSource"];
    }>(
      `
        select
          r.full_name as "repo",
          f.issue_number as "issueNumber",
          f.snapshot_id as "snapshotId",
          f.change,
          f.significance,
          f.change_group as "group",
          f.reason,
          f.related_commit_ids as "relatedCommitIds",
          f.evidence_refs as "evidenceRefs",
          f.evidence_source as "evidenceSource"
        from summary_significance_flags f
        join repositories r on r.id = f.repo_id
        ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
        order by f.snapshot_id desc nulls last, f.issue_number desc, f.id asc
        limit $${values.length}
      `,
      values,
    );

    return result.rows;
  }

  async listExtensionHistoryTrail(input: {
    repo: string;
    filePath?: string;
    snapshotId?: string;
    issueNumber?: number;
    commitSha?: string;
    limit?: number;
  }): Promise<ExtensionHistoryTrailItem[]> {
    const pool = getPool();
    if (!pool) {
      return [];
    }

    await this.ensureSchema();

    const conditions: string[] = ["r.full_name = $1"];
    const values: Array<string | number> = [input.repo];

    if (input.filePath) {
      values.push(input.filePath);
      conditions.push(`cc.filename = $${values.length}`);
    }

    if (input.issueNumber) {
      values.push(input.issueNumber);
      conditions.push(`ic.issue_number = $${values.length}`);
    }

    if (input.commitSha) {
      values.push(input.commitSha);
      conditions.push(`c.sha = $${values.length}`);
    }

    const limit = Math.min(Math.max(input.limit || 100, 1), 500);
    values.push(limit);

    const activityResult = await pool.query<{
      repo: string;
      issueNumber: number;
      issueTitle: string;
      issueUrl: string;
      commitSha: string;
      commitMessage: string;
      author: string;
      committedAt: Date;
      filename: string;
      patch: string;
      snapshotId: string | null;
    }>(
      `
        select
          r.full_name as "repo",
          ic.issue_number as "issueNumber",
          i.title as "issueTitle",
          i.url as "issueUrl",
          c.sha as "commitSha",
          c.message as "commitMessage",
          c.author,
          c.committed_at as "committedAt",
          cc.filename,
          cc.patch,
          i.snapshot_id as "snapshotId"
        from code_changes cc
        join repositories r on r.id = cc.repo_id
        join commits c on c.repo_id = cc.repo_id and c.sha = cc.commit_sha
        join issue_commits ic on ic.repo_id = cc.repo_id and ic.commit_sha = cc.commit_sha
        join issues i on i.repo_id = cc.repo_id and i.issue_number = ic.issue_number
        where ${conditions.join(" and ")}
        order by c.committed_at desc, c.sha desc
        limit $${values.length}
      `,
      values,
    );

    if (activityResult.rows.length === 0) {
      return [];
    }

    const repoIdResult = await pool.query<{ id: string }>(
      "select id from repositories where full_name = $1",
      [input.repo],
    );
    const repoId = repoIdResult.rows[0]?.id;
    if (!repoId) {
      return [];
    }

    const issueNumbers = [
      ...new Set(activityResult.rows.map((row) => row.issueNumber)),
    ];
    const commitShas = [
      ...new Set(activityResult.rows.map((row) => row.commitSha)),
    ];
    const latestSummarySnapshotFilter = input.snapshotId
      ? "s.snapshot_id = $3"
      : `s.snapshot_id = (
          select s2.snapshot_id
          from issue_summaries s2
          where s2.repo_id = s.repo_id and s2.issue_number = s.issue_number
          order by s2.generated_at desc
          limit 1
        )`;
    const summaryValues = input.snapshotId
      ? [repoId, issueNumbers, input.snapshotId]
      : [repoId, issueNumbers];

    const summaryResult = await pool.query<{
      issueNumber: number;
      snapshotId: string;
      generatedAt: Date;
      sourceLastCommitAt: Date | null;
      reusedFromGeneratedAt: Date | null;
    }>(
      `
        select
          s.issue_number as "issueNumber",
          s.snapshot_id as "snapshotId",
          s.generated_at as "generatedAt",
          s.source_last_commit_at as "sourceLastCommitAt",
          s.reused_from_generated_at as "reusedFromGeneratedAt"
        from issue_summaries s
        where s.repo_id = $1
          and s.issue_number = any($2::int[])
          and ${latestSummarySnapshotFilter}
      `,
      summaryValues,
    );

    const summaryByIssue = new Map(
      summaryResult.rows.map((row) => [row.issueNumber, row]),
    );
    const snapshotIds = [
      ...new Set(summaryResult.rows.map((row) => row.snapshotId)),
    ];

    const evidenceValues: Array<string | number[] | string[]> = [
      repoId,
      issueNumbers,
      commitShas,
    ];
    let evidenceSnapshotFilter = "";
    if (snapshotIds.length > 0) {
      evidenceValues.push(snapshotIds);
      evidenceSnapshotFilter = `and snapshot_id = any($${evidenceValues.length}::text[])`;
    }

    const [rationaleResult, contrastResult, flagResult] = await Promise.all([
      pool.query<{
        issueNumber: number;
        change: string;
        rationale: string;
        evidenceSource: string;
        evidenceRefs: string[];
        relatedCommitIds: string[];
      }>(
        `
          select
            issue_number as "issueNumber",
            change,
            rationale,
            evidence_source as "evidenceSource",
            evidence_refs as "evidenceRefs",
            related_commit_ids as "relatedCommitIds"
          from summary_what_changed
          where repo_id = $1
            and issue_number = any($2::int[])
            and related_commit_ids && $3::text[]
            ${evidenceSnapshotFilter}
          order by id asc
        `,
        evidenceValues,
      ),
      pool.query<{
        issueNumber: number;
        change: string;
        significance: string;
        group: string | null;
        before: string;
        after: string;
        rationale: string;
        evidenceSource: string;
        evidenceRefs: string[];
        relatedCommitIds: string[];
      }>(
        `
          select
            issue_number as "issueNumber",
            change,
            significance,
            change_group as "group",
            before_text as "before",
            after_text as "after",
            rationale,
            evidence_source as "evidenceSource",
            evidence_refs as "evidenceRefs",
            related_commit_ids as "relatedCommitIds"
          from summary_change_contrast
          where repo_id = $1
            and issue_number = any($2::int[])
            and related_commit_ids && $3::text[]
            ${evidenceSnapshotFilter}
          order by id asc
        `,
        evidenceValues,
      ),
      pool.query<{
        issueNumber: number;
        change: string;
        significance: string;
        group: string;
        reason: string;
        evidenceSource: string;
        evidenceRefs: string[];
        relatedCommitIds: string[];
      }>(
        `
          select
            issue_number as "issueNumber",
            change,
            significance,
            change_group as "group",
            reason,
            evidence_source as "evidenceSource",
            evidence_refs as "evidenceRefs",
            related_commit_ids as "relatedCommitIds"
          from summary_significance_flags
          where repo_id = $1
            and issue_number = any($2::int[])
            and related_commit_ids && $3::text[]
            ${evidenceSnapshotFilter}
          order by id asc
        `,
        evidenceValues,
      ),
    ]);

    return activityResult.rows.map((activity) => {
      const summary = summaryByIssue.get(activity.issueNumber) || null;
      const commitMatches = (relatedCommitIds: string[]) =>
        relatedCommitIds.includes(activity.commitSha);

      return {
        repo: activity.repo,
        snapshotId: summary?.snapshotId || activity.snapshotId,
        issueNumber: activity.issueNumber,
        issueTitle: activity.issueTitle,
        issueUrl: activity.issueUrl,
        commitSha: activity.commitSha,
        commitMessage: activity.commitMessage,
        author: activity.author,
        committedAt: activity.committedAt.toISOString(),
        filename: activity.filename,
        patch: activity.patch,
        summary: summary
          ? {
              generatedAt: summary.generatedAt.toISOString(),
              sourceLastCommitAt:
                summary.sourceLastCommitAt?.toISOString() || null,
              reusedFromGeneratedAt:
                summary.reusedFromGeneratedAt?.toISOString() || null,
            }
          : null,
        rationales: rationaleResult.rows
          .filter(
            (row) =>
              row.issueNumber === activity.issueNumber &&
              commitMatches(row.relatedCommitIds),
          )
          .map((row) => ({
            change: row.change,
            rationale: row.rationale,
            evidenceSource: row.evidenceSource,
            evidenceRefs: row.evidenceRefs,
            relatedCommitIds: row.relatedCommitIds,
          })),
        changeContrast: contrastResult.rows
          .filter(
            (row) =>
              row.issueNumber === activity.issueNumber &&
              commitMatches(row.relatedCommitIds),
          )
          .map((row) => ({
            change: row.change,
            significance: row.significance,
            group: row.group,
            before: row.before,
            after: row.after,
            rationale: row.rationale,
            evidenceSource: row.evidenceSource,
            evidenceRefs: row.evidenceRefs,
            relatedCommitIds: row.relatedCommitIds,
          })),
        significanceFlags: flagResult.rows
          .filter(
            (row) =>
              row.issueNumber === activity.issueNumber &&
              commitMatches(row.relatedCommitIds),
          )
          .map((row) => ({
            change: row.change,
            significance: row.significance,
            group: row.group,
            reason: row.reason,
            evidenceSource: row.evidenceSource,
            evidenceRefs: row.evidenceRefs,
            relatedCommitIds: row.relatedCommitIds,
          })),
      };
    });
  }

  private async upsertRepository(client: PoolClient, repo: string) {
    const result = await client.query<{ id: string }>(
      `
        insert into repositories (full_name)
        values ($1)
        on conflict (full_name)
        do update set updated_at = now()
        returning id
      `,
      [repo],
    );

    return result.rows[0].id;
  }

  private async upsertSnapshot(
    client: PoolClient,
    repoId: string,
    snapshot: SnapshotRecord,
  ) {
    await client.query(
      `
        insert into snapshots (
          id, repo_id, requested_branch_ref, stored_branch_ref, created_at,
          snapshot_dir, history_file, repo_dir, raw
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (id)
        do update set
          requested_branch_ref = excluded.requested_branch_ref,
          stored_branch_ref = excluded.stored_branch_ref,
          snapshot_dir = excluded.snapshot_dir,
          history_file = excluded.history_file,
          repo_dir = excluded.repo_dir,
          raw = excluded.raw
      `,
      [
        snapshot.id,
        repoId,
        snapshot.requestedBranchRef,
        snapshot.storedBranchRef,
        snapshot.createdAt,
        snapshot.snapshotDir,
        snapshot.historyFile,
        snapshot.repoDir,
        JSON.stringify(snapshot),
      ],
    );
  }

  private async upsertRun(
    client: PoolClient,
    repoId: string,
    run: IngestionRunRecord,
  ) {
    await client.query(
      `
        insert into ingestion_runs (
          id, repo_id, mode, status, started_at, completed_at, batch_size,
          issue_numbers, snapshot_id, generated_summary, message, error, raw
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (id)
        do update set
          status = excluded.status,
          completed_at = excluded.completed_at,
          issue_numbers = excluded.issue_numbers,
          snapshot_id = excluded.snapshot_id,
          generated_summary = excluded.generated_summary,
          message = excluded.message,
          error = excluded.error,
          raw = excluded.raw
      `,
      [
        run.id,
        repoId,
        run.mode,
        run.status,
        run.startedAt,
        run.completedAt || null,
        run.batchSize,
        run.issueNumbers,
        run.snapshotId || null,
        run.generatedSummary,
        run.message || null,
        run.error || null,
        JSON.stringify(run),
      ],
    );
  }

  private async upsertHistoricalPayload(
    client: PoolClient,
    repoId: string,
    input: {
      payload: HistoricalExportPayload;
      snapshot: SnapshotRecord;
    },
  ) {
    for (const issue of input.payload.issues) {
      await client.query(
        `
          insert into issues (
            repo_id, issue_number, snapshot_id, title, url, created_at, summary, raw
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          on conflict (repo_id, issue_number)
          do update set
            snapshot_id = excluded.snapshot_id,
            title = excluded.title,
            url = excluded.url,
            created_at = excluded.created_at,
            summary = excluded.summary,
            raw = excluded.raw
        `,
        [
          repoId,
          issue.issueNumber,
          input.snapshot.id,
          issue.title,
          issue.url,
          issue.createdAt,
          issue.summary,
          JSON.stringify(issue),
        ],
      );

      for (const discussion of issue.discussion) {
        await client.query(
          `
            insert into discussion_entries (
              repo_id, issue_number, github_id, type, author, created_at, url, body, raw
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            on conflict (repo_id, issue_number, type, github_id)
            do update set
              author = excluded.author,
              created_at = excluded.created_at,
              url = excluded.url,
              body = excluded.body,
              raw = excluded.raw
          `,
          [
            repoId,
            issue.issueNumber,
            discussion.id,
            discussion.type,
            discussion.author,
            discussion.createdAt,
            discussion.url || null,
            discussion.body,
            JSON.stringify(discussion),
          ],
        );
      }

      for (const commit of issue.commits) {
        await client.query(
          `
            insert into commits (
              repo_id, sha, message, author, committed_at, url, raw
            )
            values ($1, $2, $3, $4, $5, $6, $7)
            on conflict (repo_id, sha)
            do update set
              message = excluded.message,
              author = excluded.author,
              committed_at = excluded.committed_at,
              url = excluded.url,
              raw = excluded.raw
          `,
          [
            repoId,
            commit.sha,
            commit.message,
            commit.author,
            commit.committedAt,
            commit.url,
            JSON.stringify(commit),
          ],
        );

        await client.query(
          `
            insert into issue_commits (repo_id, issue_number, commit_sha)
            values ($1, $2, $3)
            on conflict (repo_id, issue_number, commit_sha) do nothing
          `,
          [repoId, issue.issueNumber, commit.sha],
        );

        for (const change of commit.codeChanges) {
          await client.query(
            `
              insert into code_changes (repo_id, commit_sha, filename, patch, raw)
              values ($1, $2, $3, $4, $5)
              on conflict (repo_id, commit_sha, filename)
              do update set patch = excluded.patch, raw = excluded.raw
            `,
            [
              repoId,
              commit.sha,
              change.filename,
              change.patch,
              JSON.stringify(change),
            ],
          );
        }
      }
    }
  }

  private async upsertSummaryIndex(
    client: PoolClient,
    repoId: string,
    snapshotId: string,
    summaryIndex: SnapshotSummaryIndex,
  ) {
    await client.query(
      "delete from summary_what_changed where repo_id = $1 and snapshot_id = $2",
      [repoId, snapshotId],
    );
    await client.query(
      "delete from summary_change_contrast where repo_id = $1 and snapshot_id = $2",
      [repoId, snapshotId],
    );
    await client.query(
      "delete from summary_significance_flags where repo_id = $1 and snapshot_id = $2",
      [repoId, snapshotId],
    );

    for (const issue of summaryIndex.issues) {
      await client.query(
        `
          insert into issue_summaries (
            repo_id, issue_number, snapshot_id, title, related_issue,
            pull_request, background, markdown, markdown_file, generated_at,
            model, change_size_level, change_size_rationale,
            source_last_commit_at, source_fingerprint, reused_from_generated_at,
            raw
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          on conflict (repo_id, issue_number, snapshot_id)
          do update set
            title = excluded.title,
            related_issue = excluded.related_issue,
            pull_request = excluded.pull_request,
            background = excluded.background,
            markdown = excluded.markdown,
            markdown_file = excluded.markdown_file,
            generated_at = excluded.generated_at,
            model = excluded.model,
            change_size_level = excluded.change_size_level,
            change_size_rationale = excluded.change_size_rationale,
            source_last_commit_at = excluded.source_last_commit_at,
            source_fingerprint = excluded.source_fingerprint,
            reused_from_generated_at = excluded.reused_from_generated_at,
            raw = excluded.raw
        `,
        [
          repoId,
          issue.issueNumber,
          snapshotId,
          issue.title,
          issue.relatedIssue,
          issue.pullRequest,
          issue.background,
          issue.markdown,
          issue.markdownFile,
          issue.generatedAt,
          issue.model,
          issue.changeSize?.level || null,
          issue.changeSize?.rationale || null,
          issue.sourceLastCommitAt || null,
          issue.sourceFingerprint || null,
          issue.reusedFromGeneratedAt || null,
          JSON.stringify(issue),
        ],
      );

      for (const row of issue.whatChanged) {
        await client.query(
          `
            insert into summary_what_changed (
              repo_id, issue_number, snapshot_id, change, rationale,
              related_commit_ids, evidence_refs, evidence_source, raw
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            repoId,
            issue.issueNumber,
            snapshotId,
            row.change,
            row.rationale,
            row.relatedCommitIds,
            row.evidenceRefs,
            row.evidenceSource,
            JSON.stringify(row),
          ],
        );
      }

      for (const flag of issue.significanceFlags || []) {
        await client.query(
          `
            insert into summary_significance_flags (
              repo_id, issue_number, snapshot_id, change, significance,
              change_group, reason, related_commit_ids, evidence_refs,
              evidence_source, raw
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            repoId,
            issue.issueNumber,
            snapshotId,
            flag.change,
            flag.significance,
            flag.group,
            flag.reason,
            flag.relatedCommitIds,
            flag.evidenceRefs,
            flag.evidenceSource,
            JSON.stringify(flag),
          ],
        );
      }

      for (const row of issue.changeContrast || []) {
        await client.query(
          `
            insert into summary_change_contrast (
              repo_id, issue_number, snapshot_id, change, significance,
              change_group, before_text, after_text, rationale,
              related_commit_ids, evidence_refs, evidence_source, raw
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `,
          [
            repoId,
            issue.issueNumber,
            snapshotId,
            row.change || row.aspect || "change",
            row.significance || "-",
            row.group || null,
            row.before,
            row.after,
            row.rationale,
            row.relatedCommitIds,
            row.evidenceRefs,
            row.evidenceSource,
            JSON.stringify(row),
          ],
        );
      }
    }
  }

  private async upsertAst(
    client: PoolClient,
    repoId: string,
    snapshotId: string,
    ast: SnapshotAstArtifact,
  ) {
    await client.query(
      `
        insert into snapshot_ast_artifacts (snapshot_id, repo_id, generated_at, tree)
        values ($1, $2, $3, $4)
        on conflict (snapshot_id)
        do update set
          generated_at = excluded.generated_at,
          tree = excluded.tree
      `,
      [snapshotId, repoId, ast.generatedAt, JSON.stringify(ast.tree)],
    );
  }
}
