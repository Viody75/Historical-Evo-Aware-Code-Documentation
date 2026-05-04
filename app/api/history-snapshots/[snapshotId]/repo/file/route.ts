import { NextResponse } from "next/server";

import { SnapshotWorkspaceStore } from "@/app/history-viewer/server/SnapshotWorkspaceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const snapshotStore = new SnapshotWorkspaceStore();

export async function GET(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ message: "Missing file path" }, { status: 400 });
  }

  const file = await snapshotStore.readRepoFile(snapshotId, filePath);
  if (!file) {
    return NextResponse.json({ message: "File not found" }, { status: 404 });
  }

  return NextResponse.json(file);
}
