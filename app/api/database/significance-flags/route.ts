import { NextResponse } from "next/server";

import { PostgresHistoryStore } from "@/app/history-viewer/server/PostgresHistoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postgresStore = new PostgresHistoryStore();

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

function parsePositiveInteger(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!postgresStore.isConfigured()) {
    return NextResponse.json(
      { configured: false, message: "DATABASE_URL is not configured." },
      { status: 400 },
    );
  }

  const url = new URL(request.url);

  try {
    const flags = await postgresStore.listSignificanceFlags({
      repo: url.searchParams.get("repo") || undefined,
      snapshotId: url.searchParams.get("snapshotId") || undefined,
      issueNumber: parsePositiveInteger(url.searchParams.get("issueNumber")),
      limit: parsePositiveInteger(url.searchParams.get("limit")),
    });

    return NextResponse.json({
      configured: true,
      count: flags.length,
      flags,
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        message:
          error instanceof Error
            ? error.message
            : "Failed to load significance flags",
      },
      { status: 500 },
    );
  }
}
