// ============================================================
// VSCodeGitProvider — 实现 IGitProvider（基于 simple-git）
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

  async stageFiles(files?: string[]): Promise<void> {
    if (files && files.length > 0) {
      for (const f of files) {
        try { await this.git.reset(['--', f]); } catch { /* ignore */ }
      }
    }
    await this.git.add('.');
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
    // ⭐ 检查 remote 是否存在
    try {
      const remotes = await this.git.getRemotes(true);
      const remoteExists = remotes.some((r) => r.name === remote);
      if (!remoteExists) {
        return {
          success: false, pushed: false,
          error: `远程仓库 "${remote}" 未配置。请先创建 GitHub 仓库或执行: git remote add ${remote} <url>`,
          nonFastForward: false,
        };
      }
    } catch {
      return {
        success: false, pushed: false,
        error: '当前目录不是 Git 仓库。请先点击「创建仓库」在 GitHub 创建并关联。',
        nonFastForward: false,
      };
    }

    let target = branch ?? (await this.getCurrentBranch());

    // ⭐ 验证分支是否存在于本地，不存在则回退到当前分支
    try {
      await this.git.raw(['rev-parse', '--verify', target]);
    } catch {
      const fallback = await this.getCurrentBranch();
      if (fallback && fallback !== 'HEAD') {
        target = fallback;
      } else {
        return {
          success: false, pushed: false,
          error: `本地分支 "${branch ?? target}" 不存在。请先在 Git 中创建初始提交（git commit）。`,
          nonFastForward: false,
        };
      }
    }

    try {
      await this.git.fetch(remote);
      const s = await this.git.status();
      if (s.behind > 0) {
        return { success: false, pushed: false, error: '远端有新提交，请先 Sync', nonFastForward: true };
      }
      const r = await this.git.push(remote, target);
      return { success: true, pushed: r.pushed?.length > 0 && !r.pushed[0]?.alreadyUpdated };
    } catch (e: any) {
      const nff = e.message?.includes('non-fast-forward') || e.message?.includes('rejected');
      return { success: false, pushed: false, error: e.message, nonFastForward: nff };
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
