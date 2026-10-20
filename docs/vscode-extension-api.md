# VSCode Extension API Preparation

This backend now exposes a compact history-trail API intended for a future
VSCode extension. The extension can use it to ask: "what happened historically
to this file or commit, and what rationale was generated from the issue or PR?"

## Extension History Trail

`GET /api/extension/history-trail`

Headers:

```http
Authorization: Bearer <INGESTION_TRIGGER_SECRET>
```

Query parameters:

| Name | Required | Description |
| --- | --- | --- |
| `repo` | Yes | GitHub repository in `owner/repo` format. |
| `filePath` | No | Limit history to one file path from the repository. |
| `snapshotId` | No | Read generated rationale from a specific snapshot. |
| `issueNumber` | No | Limit results to one issue or pull request number. |
| `commitSha` | No | Limit results to one commit. |
| `limit` | No | Maximum history rows, clamped to `1..500`. |

Example:

```bash
curl "$BASE_URL/api/extension/history-trail?repo=23525039-viody75/test-ajah&filePath=src/index.ts&limit=25" \
  -H "Authorization: Bearer $INGESTION_TRIGGER_SECRET"
```

Response shape:

```json
{
  "configured": true,
  "repo": "owner/repo",
  "filePath": "src/index.ts",
  "count": 1,
  "items": [
    {
      "repo": "owner/repo",
      "snapshotId": "owner-repo-2026-10-12T00-00-00-000Z",
      "issueNumber": 12,
      "issueTitle": "Fix editor state",
      "issueUrl": "https://github.com/owner/repo/pull/12",
      "commitSha": "abc123",
      "commitMessage": "fix: persist editor state",
      "author": "octocat",
      "committedAt": "2026-10-12T00:00:00.000Z",
      "filename": "src/index.ts",
      "patch": "@@ ...",
      "summary": {
        "generatedAt": "2026-10-12T00:01:00.000Z",
        "sourceLastCommitAt": "2026-10-12T00:00:00.000Z",
        "reusedFromGeneratedAt": null
      },
      "rationales": [],
      "changeContrast": [],
      "significanceFlags": []
    }
  ]
}
```

The extension should sort or render the returned items as a timeline using
`committedAt`. The API already returns newest commits first.

## Existing Automation Endpoints

`POST /api/ingestion/trigger`

Use this for manual or scheduled continuation of repository ingestion.

```json
{
  "repo": "owner/repo",
  "mode": "recent",
  "batchSize": 3,
  "generateSummaries": true
}
```

`POST /api/webhook`

Use this as the VCS webhook receiver. It can enqueue or trigger ingestion for
new merged pull requests and newly closed issues, depending on the payload.

## Firebase App Hosting

This repository includes `apphosting.yaml` for Firebase App Hosting runtime
configuration. Runtime secrets are referenced by name and should be created in
Firebase/Google Secret Manager:

```bash
firebase apphosting:secrets:set DATABASE_URL
firebase apphosting:secrets:set GITHUB_TOKEN
firebase apphosting:secrets:set OPENAI_API_KEY
firebase apphosting:secrets:set INGESTION_TRIGGER_SECRET
```

Then create or connect an App Hosting backend from this repository root and
deploy through Firebase:

```bash
firebase apphosting:backends:create --project <firebase-project-id>
firebase deploy --project <firebase-project-id>
```

Keep `WEBHOOK_GENERATE_SUMMARIES=false` for production until you intentionally
allow webhook-triggered private repository data to be sent to the LLM provider.
