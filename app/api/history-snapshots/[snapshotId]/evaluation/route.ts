import { NextResponse } from "next/server";

import { RationaleEvaluationService } from "@/app/history-viewer/server/RationaleEvaluationService";
import { SnapshotWorkspaceStore } from "@/app/history-viewer/server/SnapshotWorkspaceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const snapshotStore = new SnapshotWorkspaceStore();
const evaluationService = new RationaleEvaluationService();

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getEvaluationInputs(snapshotId: string) {
  const [snapshot, payload, summaryArtifacts] = await Promise.all([
    snapshotStore.getSnapshotById(snapshotId),
    snapshotStore.getSnapshotHistory(snapshotId),
    snapshotStore.getSnapshotSummaryArtifacts(snapshotId),
  ]);

  if (!snapshot || !payload) {
    return { error: "Snapshot not found" } as const;
  }
  if (!summaryArtifacts.index) {
    return {
      error: "Generate snapshot summaries before running quantitative testing",
    } as const;
  }

  return {
    snapshot,
    payload,
    summaryIndex: summaryArtifacts.index,
  } as const;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  const inputs = await getEvaluationInputs(snapshotId);
  if ("error" in inputs) {
    return NextResponse.json({ message: inputs.error }, { status: 404 });
  }

  try {
    return NextResponse.json(await evaluationService.getState(inputs));
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to load quantitative testing state",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        groundTruth?: unknown;
        generatedComparison?: unknown;
      }
    | null;

  if (!isJsonObject(body?.groundTruth)) {
    return NextResponse.json(
      { message: "A valid groundTruth JSON object is required" },
      { status: 400 },
    );
  }

  if (!isJsonObject(body?.generatedComparison)) {
    return NextResponse.json(
      { message: "A valid generatedComparison JSON object is required" },
      { status: 400 },
    );
  }

  const inputs = await getEvaluationInputs(snapshotId);
  if ("error" in inputs) {
    return NextResponse.json({ message: inputs.error }, { status: 404 });
  }

  try {
    return NextResponse.json(
      await evaluationService.run({
        ...inputs,
        groundTruth: body.groundTruth,
        generatedComparison: body.generatedComparison,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to run quantitative testing",
      },
      { status: 500 },
    );
  }
}
