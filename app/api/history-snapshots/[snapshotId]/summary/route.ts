import { NextResponse } from "next/server";

import {
  PostgresHistoryStore,
  type PostgresPersistResult,
} from "@/app/history-viewer/server/PostgresHistoryStore";
import { SnapshotSummaryService } from "@/app/history-viewer/server/SnapshotSummaryService";
import { SnapshotWorkspaceStore } from "@/app/history-viewer/server/SnapshotWorkspaceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const snapshotStore = new SnapshotWorkspaceStore();
const summaryService = new SnapshotSummaryService();
const postgresStore = new PostgresHistoryStore();

export async function GET(
  _request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  const artifacts = await snapshotStore.getSnapshotSummaryArtifacts(snapshotId);

  return NextResponse.json({
    ...artifacts,
    defaultModel: summaryService.getDefaultModel(),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        apiKey?: string;
        model?: string;
        forceRegenerate?: boolean;
      }
    | null;

  const apiKey = body?.apiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { message: "OpenAI API key is required" },
      { status: 400 },
    );
  }

  const payload = await snapshotStore.getSnapshotHistory(snapshotId);
  if (!payload) {
    return NextResponse.json({ message: "Snapshot not found" }, { status: 404 });
  }

  try {
    const previousArtifacts =
      await snapshotStore.getSnapshotSummaryArtifacts(snapshotId);
    const artifacts = await summaryService.generateArtifacts({
      apiKey,
      payload,
      model: body?.model,
      previousIndex: previousArtifacts.index,
      forceRegenerate: body?.forceRegenerate,
    });
    await snapshotStore.saveSnapshotSummaryArtifacts(snapshotId, artifacts);
    const snapshot = await snapshotStore.getSnapshotById(snapshotId);

    let database: PostgresPersistResult = {
      persisted: false,
      reason: "DATABASE_URL is not configured",
    };
    if (snapshot) {
      try {
        database = await postgresStore.persistIngestionResult({
          payload,
          snapshot,
          run: {
            id: `summary-${snapshotId}-${artifacts.index.generatedAt.replace(/[:.]/g, "-")}`,
            repo: payload.repo,
            mode: "issue",
            status: "completed",
            startedAt: artifacts.index.generatedAt,
            completedAt: artifacts.index.generatedAt,
            batchSize: payload.issues.length,
            issueNumbers: payload.issues.map((issue) => issue.issueNumber),
            snapshotId,
            generatedSummary: true,
            message: "Generated snapshot summaries.",
          },
          summaryIndex: artifacts.index,
          ast: artifacts.ast,
        });
      } catch (error) {
        database = {
          persisted: false,
          reason:
            error instanceof Error
              ? error.message
              : "Failed to persist summary artifacts to Postgres",
        };
      }
    }

    return NextResponse.json({
      ...artifacts,
      defaultModel: summaryService.getDefaultModel(),
      database,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to generate snapshot summaries",
      },
      { status: 500 },
    );
  }
}
