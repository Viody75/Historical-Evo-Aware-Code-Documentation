import { NextResponse } from "next/server";

import { GitHubIngestionService } from "@/app/history-viewer/server/GitHubIngestionService";

type ParsedBody = Record<string, unknown> | string | null;

type GitHubPullRequestWebhook = {
  action?: string;
  repository?: {
    full_name?: string;
    default_branch?: string;
  };
  pull_request?: {
    number?: number;
    merged?: boolean;
    base?: {
      ref?: string;
    };
  };
};

const ingestionService = new GitHubIngestionService();

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
  const secret = process.env.INGESTION_TRIGGER_SECRET;
  const headerSecret = request.headers.get("x-ingestion-secret") || "";

  if (secret && headerSecret !== secret) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (event === "pull_request" && body && typeof body === "object") {
    const payload = body as GitHubPullRequestWebhook;
    const repo = payload.repository?.full_name;
    const issueNumber = payload.pull_request?.number;
    const isMergedPullRequest =
      payload.action === "closed" && payload.pull_request?.merged === true;

    if (repo && issueNumber && isMergedPullRequest) {
      const result = await ingestionService.run({
        repo,
        mode: "issue",
        issueNumber,
        batchSize: 1,
        branchRef:
          payload.repository?.default_branch || payload.pull_request?.base?.ref,
        generateSummaries: process.env.WEBHOOK_GENERATE_SUMMARIES === "true",
      });

      return NextResponse.json(
        {
          ok: true,
          route: "/api/webhook",
          received: true,
          event,
          triggered: true,
          result,
        },
        { status: 202 },
      );
    }
  }

  return NextResponse.json(
    {
      ok: true,
      route: "/api/webhook",
      received: true,
      event,
      triggered: false,
      bodyType: body === null ? "empty" : typeof body === "string" ? "text" : "json",
      message:
        "Webhook received. No ingestion was triggered for this event.",
    },
    { status: 202 },
  );
}
