import { NextResponse } from "next/server";

type ParsedBody = Record<string, unknown> | string | null;

const parseRequestBody = async (request: Request): Promise<ParsedBody> => {
  const contentType = request.headers.get("content-type") || "";
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return null;
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return rawBody;
    }
  }

  return rawBody;
};

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/webhook",
    message: "Webhook endpoint is available.",
  });
}

export async function POST(request: Request) {
  const body = await parseRequestBody(request);
  const event =
    request.headers.get("x-github-event") ||
    request.headers.get("x-event-key") ||
    "unknown";

  return NextResponse.json(
    {
      ok: true,
      route: "/api/webhook",
      received: true,
      event,
      bodyType: body === null ? "empty" : typeof body === "string" ? "text" : "json",
      message:
        "Webhook received. This is a stub handler and does not trigger application logic yet.",
    },
    { status: 202 },
  );
}
