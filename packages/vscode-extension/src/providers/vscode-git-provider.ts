// ============================================================
// VSCodeGitProvider — implements IGitProvider (based on simple-git)
// ============================================================

import type { IGitProvider, GitStatus, CommitResult, PushResult } from '@gitpilot/core';
import simpleGit, { SimpleGit } from 'simple-git';

export class VSCodeGitProvider implements IGitProvider {
  private git: SimpleGit;

  constructor(workspaceRoot: string) {
    this.git = simpleGit(workspaceRoot);
  }

  async isRepo(): Promise<boolean> {
    try { return await this.git.checkIsRepo(); } catch { return false; }
  }

  async init(): Promise<void> { await this.git.init(); }

  async getStatus(): Promise<GitStatus> {
    const s = await this.git.status();
    return {
      isClean: s.isClean(),
      modified: s.modified,
      added: s.created,
      deleted: s.deleted,
      untracked: s.not_added,
      staged: s.staged,
      currentBranch: s.current ?? 'unknown',
      ahead: s.ahead,
      behind: s.behind,
      hasConflicts: s.conflicted.length > 0,
    };
  }

  async hasChanges(): Promise<boolean> {
    const s = await this.getStatus();
    return !s.isClean;
  }

  async stageFiles(excludeFiles?: string[]): Promise<void> {
    // ⭐ Use git add -A to stage all changes (added + modified + deleted)
    await this.git.raw(['add', '-A']);
    // ⭐ Then unstage the files to exclude (secrets, build artifacts, etc.)
    if (excludeFiles && excludeFiles.length > 0) {
      for (const f of excludeFiles) {
        try { await this.git.raw(['reset', '--', f]); } catch {
          try { await this.git.raw(['rm', '--cached', '-r', '--quiet', f]); } catch { /* non-critical */ }
        }
      }
    }
  }

  /** ⭐ Get the list of currently staged files (for debugging/logging) */
  async getStagedFiles(): Promise<string[]> {
    try {
      const result = await this.git.raw(['diff', '--cached', '--name-only']);
      return result.split('\n').filter(f => f.trim());
    } catch { return []; }
  }

  async commit(message: string): Promise<CommitResult> {
    try {
      const r = await this.git.commit(message);
      return {
        success: true,
        hash: r.commit ?? null,
        message: `${r.summary?.changes ?? 0} changes`,
      };
    } catch (e: any) {
      return { success: false, hash: null, message: 'Commit failed', error: e.message };
    }
  }

  async push(remote: string = 'origin', branch?: string): Promise<PushResult> {
    // ⭐ Check whether the remote exists
    try {
      const remotes = await this.git.getRemotes(true);
      const remoteExists = remotes.some((r) => r.name === remote);
      if (!remoteExists) {
        return {
          success: false, pushed: false,
          error: 'ORIGIN_MISSING:No GitHub repository linked',
          nonFastForward: false,
        };
      }
    } catch {
      return {
        success: false, pushed: false,
        error: 'ORIGIN_MISSING:The current directory is not a Git repository',
        nonFastForward: false,
      };
    }

    let target = branch ?? (await this.getCurrentBranch());

    // ⭐ Verify the branch exists locally; fall back to the current branch if not
    try {
      await this.git.raw(['rev-parse', '--verify', target]);
    } catch {
      const fallback = await this.getCurrentBranch();
      if (fallback && fallback !== 'HEAD') {
        target = fallback;
      } else {
        return {
          success: false, pushed: false,
          error: `The local branch "${branch ?? target}" does not exist. Please create an initial commit first (git commit).`,
          nonFastForward: false,
        };
      }
    }

    try {
      await this.git.fetch(remote);
      const s = await this.git.status();
      if (s.behind > 0) {
        return { success: false, pushed: false, error: 'The remote has new commits, please run Sync first', nonFastForward: true };
      }
      const r = await this.git.push(remote, target);
      return { success: true, pushed: r.pushed?.length > 0 && !r.pushed[0]?.alreadyUpdated };
    } catch (e: any) {
      const msg: string = e.message ?? '';
      const nff = msg.includes('non-fast-forward') || msg.includes('rejected');

      // ⭐ Detect network errors and show friendly messages
      if (msg.includes('Connection was reset') || msg.includes('Connection reset')) {
        return { success: false, pushed: false, error: 'NETWORK_RESET:The network connection was reset. Please check your network or try again later.', nonFastForward: false };
      }
      if (msg.includes('unable to access') || msg.includes('Could not resolve host')) {
        return { success: false, pushed: false, error: 'NETWORK_UNREACHABLE:Unable to reach GitHub. Please check your network connection.', nonFastForward: false };
      }
      if (msg.includes('timeout') || msg.includes('timed out')) {
        return { success: false, pushed: false, error: 'NETWORK_TIMEOUT:Timed out connecting to GitHub. Please check your network or proxy settings.', nonFastForward: false };
      }
      if (msg.includes('Recv failure')) {
        return { success: false, pushed: false, error: 'NETWORK_RESET:The network connection was reset. Please check your network or try again later.', nonFastForward: false };
      }

      return { success: false, pushed: false, error: msg, nonFastForward: nff };
    }
  }

  async pull(remote?: string, branch?: string): Promise<{ success: boolean; error?: string }> {
    try { await this.git.pull(remote, branch); return { success: true }; }
    catch (e: any) { return { success: false, error: e.message }; }
  }

  async getCurrentBranch(): Promise<string> {
    const b = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    return b.trim();
  }

  async getLatestCommitHash(): Promise<string | null> {
    try { const log = await this.git.log({ maxCount: 1 }); return log.latest?.hash ?? null; }
    catch { return null; }
  }

  async getRemoteUrl(remote?: string): Promise<string | null> {
    try {
      const remotes = await this.git.getRemotes(true);
      const r = remotes.find((r) => r.name === (remote ?? 'origin'));
      return r?.refs.fetch ?? null;
    } catch { return null; }
  }

  async listBranches(): Promise<string[]> {
    const b = await this.git.branchLocal();
    return b.all;
  }

  async checkout(branch: string): Promise<void> { await this.git.checkout(branch); }
  async addRemote(name: string, url: string): Promise<void> {
    const remotes = await this.git.getRemotes(true);
    if (remotes.some((r) => r.name === name)) {
      await this.git.remote(['set-url', name, url]);
    } else {
      await this.git.addRemote(name, url);
    }
  }
}
