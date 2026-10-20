import { NextResponse } from "next/server";

import { GitHubIngestionService } from "@/app/history-viewer/server/GitHubIngestionService";
import type { IngestionMode } from "@/app/history-viewer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ingestionService = new GitHubIngestionService();

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

  const body = (await request.json().catch(() => null)) as
    | {
        repo?: string;
        mode?: IngestionMode;
        batchSize?: number;
        branchRef?: string;
        issueNumber?: number;
        generateSummaries?: boolean;
        model?: string;
      }
    | null;

  if (!body?.repo) {
    return NextResponse.json(
      { message: "repo is required. Use owner/repo or a GitHub repo URL." },
      { status: 400 },
    );
  }

  try {
    const result = await ingestionService.run({
      repo: body.repo,
      mode: body.mode,
      batchSize: body.batchSize,
      branchRef: body.branchRef,
      issueNumber: body.issueNumber,
      generateSummaries: body.generateSummaries,
      model: body.model,
    });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Ingestion failed",
      },
      { status: 500 },
    );
  }
}
