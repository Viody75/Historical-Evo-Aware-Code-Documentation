import { NextResponse } from "next/server";

import { PostgresHistoryStore } from "@/app/history-viewer/server/PostgresHistoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postgresStore = new PostgresHistoryStore();

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      process.env.EXTENSION_API_ALLOWED_ORIGIN?.trim() || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, x-ingestion-secret",
  };
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders(),
      ...init?.headers,
    },
  });
}

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

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!postgresStore.isConfigured()) {
    return json(
      { configured: false, message: "DATABASE_URL is not configured." },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const repo = url.searchParams.get("repo")?.trim();

  if (!repo) {
    return json(
      { message: "repo is required. Use owner/repo." },
      { status: 400 },
    );
  }

  try {
    const items = await postgresStore.listExtensionHistoryTrail({
      repo,
      filePath: url.searchParams.get("filePath") || undefined,
      snapshotId: url.searchParams.get("snapshotId") || undefined,
      issueNumber: parsePositiveInteger(url.searchParams.get("issueNumber")),
      commitSha: url.searchParams.get("commitSha") || undefined,
      limit: parsePositiveInteger(url.searchParams.get("limit")),
    });

    return json({
      configured: true,
      repo,
      filePath: url.searchParams.get("filePath") || null,
      count: items.length,
      items,
    });
  } catch (error) {
    return json(
      {
        configured: true,
        message:
          error instanceof Error
            ? error.message
            : "Failed to load extension history trail",
      },
      { status: 500 },
    );
  }
}
