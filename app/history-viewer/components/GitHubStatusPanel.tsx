import type { GitHubDebugStatus } from "@/app/history-viewer/types";

export function GitHubStatusPanel({
  debugStatus,
  debugError,
  debugLoading,
  onRefresh,
}: {
  debugStatus: GitHubDebugStatus | null;
  debugError: string;
  debugLoading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          GitHub API Status
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              debugStatus?.authenticated
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {debugStatus?.authenticated ? "Authenticated" : "Unauthenticated"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {debugStatus
              ? `${debugStatus.rateLimit.remaining}/${debugStatus.rateLimit.limit} remaining`
              : "Rate limit unknown"}
          </span>
          {debugStatus && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              Reset {new Date(debugStatus.rateLimit.resetAt).toLocaleString()}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-slate-600">
          {debugStatus?.envConfigured
            ? "Server membaca GITHUB_TOKEN."
            : "Server belum membaca GITHUB_TOKEN. Pastikan file .env.local ada lalu restart dev server."}
        </p>
        {debugError && <p className="mt-2 text-sm text-rose-600">{debugError}</p>}
      </div>
      <button
        onClick={onRefresh}
        disabled={debugLoading}
        className="rounded-xl bg-slate-200 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-300 disabled:opacity-50"
      >
        {debugLoading ? "Refreshing status..." : "Refresh GitHub Status"}
      </button>
    </div>
  );
}
