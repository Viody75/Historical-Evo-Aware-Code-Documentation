import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  HistoricalExportPayload,
  SnapshotRecord,
  SnapshotRepoFileContent,
  SnapshotRepoFileEntry,
} from "@/app/history-viewer/types";

const execFileAsync = promisify(execFile);

export class SnapshotWorkspaceStore {
  constructor(private readonly rootDir = path.join(process.cwd(), "storage", "history-snapshots")) {}

  getRootDir() {
    return this.rootDir;
  }

  async listSnapshots(): Promise<SnapshotRecord[]> {
    await this.ensureRoot();

    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.rootDir, entry.name));

    const snapshots = (
      await Promise.all(directories.map((directory) => this.readSnapshotMetadata(directory)))
    ).filter((snapshot): snapshot is SnapshotRecord => snapshot !== null);

    return snapshots.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  }

  async getSnapshotById(snapshotId: string): Promise<SnapshotRecord | null> {
    const snapshotDir = path.join(this.rootDir, snapshotId);
    return this.readSnapshotMetadata(snapshotDir);
  }

  async getSnapshotHistory(snapshotId: string): Promise<HistoricalExportPayload | null> {
    const snapshot = await this.getSnapshotById(snapshotId);
    if (!snapshot) {
      return null;
    }

    try {
      const raw = await readFile(snapshot.historyFile, "utf8");
      return JSON.parse(raw) as HistoricalExportPayload;
    } catch {
      return null;
    }
  }

  async listRepoFiles(snapshotId: string): Promise<SnapshotRepoFileEntry[]> {
    const snapshot = await this.getSnapshotById(snapshotId);
    if (!snapshot) {
      return [];
    }

    return this.walkRepoFiles(snapshot.repoDir, "");
  }

  async readRepoFile(
    snapshotId: string,
    filePath: string,
  ): Promise<SnapshotRepoFileContent | null> {
    const snapshot = await this.getSnapshotById(snapshotId);
    if (!snapshot) {
      return null;
    }

    const resolvedPath = path.resolve(snapshot.repoDir, filePath);
    const repoRoot = path.resolve(snapshot.repoDir);

    if (!resolvedPath.startsWith(repoRoot)) {
      return null;
    }

    try {
      const buffer = await readFile(resolvedPath);
      const isBinary = buffer.includes(0);

      return {
        path: filePath,
        content: isBinary ? "" : buffer.toString("utf8"),
        isBinary,
      };
    } catch {
      return null;
    }
  }

  async createSnapshot(input: {
    repoName: string;
    requestedBranchRef: string;
    payload: HistoricalExportPayload;
  }): Promise<SnapshotRecord> {
    const snapshotId = this.createSnapshotId(input.repoName);
    const snapshotDir = path.join(this.rootDir, snapshotId);
    const historyDir = path.join(snapshotDir, "history");
    const repoDir = path.join(snapshotDir, "repo");
    const historyFile = path.join(historyDir, "history.json");

    try {
      await this.ensureRoot();
      await mkdir(historyDir, { recursive: true });
      await writeFile(historyFile, JSON.stringify(input.payload, null, 2), "utf8");

      const storedBranchRef = await this.cloneRepository({
        repoName: input.repoName,
        requestedBranchRef: input.requestedBranchRef,
        repoDir,
      });

      const snapshot: SnapshotRecord = {
        id: snapshotId,
        repoName: input.repoName,
        requestedBranchRef: input.requestedBranchRef,
        storedBranchRef,
        createdAt: new Date().toISOString(),
        snapshotDir,
        historyFile,
        repoDir,
      };

      await writeFile(
        path.join(snapshotDir, "metadata.json"),
        JSON.stringify(snapshot, null, 2),
        "utf8",
      );

      return snapshot;
    } catch (error) {
      await rm(snapshotDir, { recursive: true, force: true });
      throw error;
    }
  }

  private async ensureRoot() {
    await mkdir(this.rootDir, { recursive: true });
  }

  private sanitizeSegment(value: string) {
    return value.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  }

  private createSnapshotId(repoName: string) {
    return `${this.sanitizeSegment(repoName)}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }

  private async readSnapshotMetadata(snapshotDir: string): Promise<SnapshotRecord | null> {
    const metadataPath = path.join(snapshotDir, "metadata.json");

    try {
      const raw = await readFile(metadataPath, "utf8");
      return JSON.parse(raw) as SnapshotRecord;
    } catch {
      return null;
    }
  }

  private async fetchDefaultBranch(repoName: string) {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "nextjs-github-history-analyzer",
    };

    if (token) {
      headers.Authorization = `token ${token}`;
    }

    const response = await fetch(`https://api.github.com/repos/${repoName}`, {
      headers,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { default_branch?: string };
    return data.default_branch || null;
  }

  private async walkRepoFiles(
    absoluteDir: string,
    relativeDir: string,
  ): Promise<SnapshotRepoFileEntry[]> {
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    const files: SnapshotRepoFileEntry[] = [];

    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }

      const nextRelativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      const nextAbsolutePath = path.join(absoluteDir, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await this.walkRepoFiles(nextAbsolutePath, nextRelativePath)));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStat = await stat(nextAbsolutePath);
      files.push({
        path: nextRelativePath,
        size: fileStat.size,
      });
    }

    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async cloneRepository(input: {
    repoName: string;
    requestedBranchRef: string;
    repoDir: string;
  }) {
    const cloneUrl = `https://github.com/${input.repoName}.git`;
    const defaultBranch = await this.fetchDefaultBranch(input.repoName);
    const candidateBranches = Array.from(
      new Set(
        [input.requestedBranchRef, defaultBranch].filter(
          (branch): branch is string => Boolean(branch && branch.trim()),
        ),
      ),
    );

    let lastError: unknown = null;

    for (const branchRef of candidateBranches) {
      try {
        await execFileAsync("git", [
          "clone",
          "--depth",
          "1",
          "--branch",
          branchRef,
          "--single-branch",
          cloneUrl,
          input.repoDir,
        ]);
        return branchRef;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Failed to clone repository snapshot");
  }
}
