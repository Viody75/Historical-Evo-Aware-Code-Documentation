import { NextResponse } from "next/server";

import { SnapshotWorkspaceStore } from "@/app/history-viewer/server/SnapshotWorkspaceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const snapshotStore = new SnapshotWorkspaceStore();

export async function GET(
  _request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  const files = await snapshotStore.listRepoFiles(snapshotId);
  return NextResponse.json(files);
}
