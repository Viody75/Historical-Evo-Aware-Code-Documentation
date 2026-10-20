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

export async function GET() {
  return NextResponse.json({
    configured: postgresStore.isConfigured(),
    message: postgresStore.isConfigured()
      ? "DATABASE_URL is configured."
      : "DATABASE_URL is not configured.",
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!postgresStore.isConfigured()) {
    return NextResponse.json(
      { configured: false, message: "DATABASE_URL is not configured." },
      { status: 400 },
    );
  }

  try {
    await postgresStore.ensureSchema();
    return NextResponse.json({
      configured: true,
      initialized: true,
      message: "Postgres schema is ready.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        initialized: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to initialize Postgres schema",
      },
      { status: 500 },
    );
  }
}
