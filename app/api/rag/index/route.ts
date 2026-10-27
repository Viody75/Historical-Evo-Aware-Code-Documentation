import { NextResponse } from "next/server";

import { PostgresHistoryStore } from "@/app/history-viewer/server/PostgresHistoryStore";
import { SnapshotWorkspaceStore } from "@/app/history-viewer/server/SnapshotWorkspaceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postgresStore = new PostgresHistoryStore();
const snapshotStore = new SnapshotWorkspaceStore();

function isAuthorized(request: Request) {
  const secret = process.env.INGESTION_TRIGGER_SECRET;
  if (!secret) {
    return true;
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const headerSecret = request.headers.get("x-ingestion-secret") || "";

  return bearer === secret || headerSecret === secret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!postgresStore.isConfigured()) {
    return NextResponse.json(
      { message: "DATABASE_URL is not configured" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { snapshotId?: string }
    | null;
  const snapshotId = body?.snapshotId?.trim();
  if (!snapshotId) {
    return NextResponse.json(
      { message: "snapshotId is required" },
      { status: 400 },
    );
  }

  const [snapshot, payload, summaryArtifacts] = await Promise.all([
    snapshotStore.getSnapshotById(snapshotId),
    snapshotStore.getSnapshotHistory(snapshotId),
    snapshotStore.getSnapshotSummaryArtifacts(snapshotId),
  ]);

  if (!snapshot || !payload) {
    return NextResponse.json({ message: "Snapshot not found" }, { status: 404 });
  }

  try {
    const result = await postgresStore.indexSnapshotForRag({
      snapshot,
      payload,
      summaryIndex: summaryArtifacts.index,
    });

    return NextResponse.json({
      ok: result.persisted,
      repo: payload.repo,
      snapshotId,
      indexedDocuments: result.ragDocumentsIndexed || 0,
      reason: result.reason,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to index snapshot",
      },
      { status: 500 },
    );
  }
}
