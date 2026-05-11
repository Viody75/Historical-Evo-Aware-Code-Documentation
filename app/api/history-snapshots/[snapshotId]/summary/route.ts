import { NextResponse } from "next/server";

import { SnapshotSummaryService } from "@/app/history-viewer/server/SnapshotSummaryService";
import { SnapshotWorkspaceStore } from "@/app/history-viewer/server/SnapshotWorkspaceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const snapshotStore = new SnapshotWorkspaceStore();
const summaryService = new SnapshotSummaryService();

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
    const artifacts = await summaryService.generateArtifacts({
      apiKey,
      payload,
      model: body?.model,
    });
    await snapshotStore.saveSnapshotSummaryArtifacts(snapshotId, artifacts);

    return NextResponse.json({
      ...artifacts,
      defaultModel: summaryService.getDefaultModel(),
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
