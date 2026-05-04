import { NextResponse } from "next/server";

interface GitHubRateLimitResource {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

interface GitHubRateLimitResponse {
  rate: GitHubRateLimitResource;
  resources?: {
    core?: GitHubRateLimitResource;
    search?: GitHubRateLimitResource;
    graphql?: GitHubRateLimitResource;
  };
}

export async function GET() {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "nextjs-github-history-analyzer",
  };

  if (token) {
    headers.Authorization = `token ${token}`;
  }

  const response = await fetch("https://api.github.com/rate_limit", {
    headers,
    cache: "no-store",
  });

  const rawBody = await response.text();

  if (!response.ok) {
    return NextResponse.json(
      {
        authenticated: Boolean(token),
        message: rawBody || "Failed to fetch GitHub rate limit",
      },
      { status: response.status },
    );
  }

  if (!rawBody.trim()) {
    return NextResponse.json(
      {
        authenticated: Boolean(token),
        message: "GitHub returned an empty rate limit response",
      },
      { status: 502 },
    );
  }

  const data = JSON.parse(rawBody) as GitHubRateLimitResponse;
  const rate = data.resources?.core ?? data.rate;

  return NextResponse.json(
    {
      authenticated: Boolean(token),
      envConfigured: Boolean(token),
      rateLimit: {
        limit: rate.limit,
        remaining: rate.remaining,
        used: rate.used,
        resetAt: new Date(rate.reset * 1000).toISOString(),
      },
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
