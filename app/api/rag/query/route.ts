import { NextResponse } from "next/server";

import { PostgresHistoryStore } from "@/app/history-viewer/server/PostgresHistoryStore";
import { RagAnswerService } from "@/app/history-viewer/server/RagAnswerService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postgresStore = new PostgresHistoryStore();
const ragService = new RagAnswerService(postgresStore);

function parseLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(Math.max(Math.floor(value), 1), 12);
}

export async function POST(request: Request) {
  if (!postgresStore.isConfigured()) {
    return NextResponse.json(
      { message: "DATABASE_URL is not configured" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        repo?: string;
        snapshotId?: string;
        question?: string;
        limit?: number;
        apiKey?: string;
        model?: string;
        retrieveOnly?: boolean;
      }
    | null;

  const repo = body?.repo?.trim();
  const question = body?.question?.trim();
  if (!repo || !question) {
    return NextResponse.json(
      { message: "repo and question are required" },
      { status: 400 },
    );
  }

  const apiKey = body?.apiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!body?.retrieveOnly && !apiKey) {
    return NextResponse.json(
      { message: "OpenAI API key is required" },
      { status: 400 },
    );
  }

  try {
    const result = await ragService.query({
      repo,
      snapshotId: body?.snapshotId?.trim() || undefined,
      question,
      limit: parseLimit(body?.limit),
      apiKey,
      model: body?.model,
      retrieveOnly: body?.retrieveOnly,
    });

    return NextResponse.json({
      ...result,
      defaultModel: ragService.getDefaultModel(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "RAG query failed";
    const status = message.includes("index was not found") ? 404 : 500;
    return NextResponse.json({ message }, { status });
  }
}
