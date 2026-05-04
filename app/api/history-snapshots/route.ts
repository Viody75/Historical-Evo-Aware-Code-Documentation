import { NextResponse } from "next/server";

import { SnapshotWorkspaceStore } from "@/app/history-viewer/server/SnapshotWorkspaceStore";
import type { HistoricalExportPayload } from "@/app/history-viewer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const snapshotStore = new SnapshotWorkspaceStore();

export async function GET() {
  const snapshots = await snapshotStore.listSnapshots();
  return NextResponse.json(snapshots);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        repoName?: string;
        branchRef?: string;
        payload?: HistoricalExportPayload;
      }
    | null;

  if (!body?.repoName || !body.branchRef || !body.payload) {
    return NextResponse.json(
      { message: "repoName, branchRef, and payload are required" },
      { status: 400 },
    );
  }

  try {
    const snapshot = await snapshotStore.createSnapshot({
      repoName: body.repoName,
      requestedBranchRef: body.branchRef,
      payload: body.payload,
    });

    return NextResponse.json(snapshot, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to save repository snapshot";

    return NextResponse.json({ message }, { status: 500 });
  }
}
