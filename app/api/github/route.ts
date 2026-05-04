import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get("endpoint");
  const accept = url.searchParams.get("accept");

  if (!endpoint) {
    return NextResponse.json(
      { message: "Missing GitHub endpoint" },
      { status: 400 },
    );
  }

  const token = process.env.GITHUB_TOKEN;
  const apiUrl = `https://api.github.com${endpoint}`;

  const headers: Record<string, string> = {
    Accept: accept || "application/vnd.github+json",
    "User-Agent": "nextjs-github-history-analyzer",
  };

  if (token) {
    headers.Authorization = `token ${token}`;
  }

  const response = await fetch(apiUrl, {
    headers,
  });

  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
      "x-github-authenticated": token ? "true" : "false",
      "x-github-rate-limit-limit":
        response.headers.get("x-ratelimit-limit") ?? "",
      "x-github-rate-limit-remaining":
        response.headers.get("x-ratelimit-remaining") ?? "",
      "x-github-rate-limit-reset":
        response.headers.get("x-ratelimit-reset") ?? "",
    },
  });
}
