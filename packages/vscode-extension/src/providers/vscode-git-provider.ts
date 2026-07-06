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

  async stageFiles(excludeFiles?: string[]): Promise<void> {
    // ⭐ 使用 git add -A 暂存所有变更（新增+修改+删除）
    await this.git.raw(['add', '-A']);
    // ⭐ 再取消暂存需要排除的文件（密钥、构建产物等）
    if (excludeFiles && excludeFiles.length > 0) {
      for (const f of excludeFiles) {
        try { await this.git.raw(['reset', '--', f]); } catch {
          try { await this.git.raw(['rm', '--cached', '-r', '--quiet', f]); } catch { /* 非关键 */ }
        }
      }
    }
  }

  /** ⭐ 获取当前已暂存的文件列表（用于调试/日志） */
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
    // ⭐ 检查 remote 是否存在
    try {
      const remotes = await this.git.getRemotes(true);
      const remoteExists = remotes.some((r) => r.name === remote);
      if (!remoteExists) {
        return {
          success: false, pushed: false,
          error: 'ORIGIN_MISSING:未关联GitHub仓库',
          nonFastForward: false,
        };
      }
    } catch {
      return {
        success: false, pushed: false,
        error: 'ORIGIN_MISSING:当前目录非Git仓库',
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
      const msg: string = e.message ?? '';
      const nff = msg.includes('non-fast-forward') || msg.includes('rejected');

      // ⭐ 检测网络错误，给出友好提示
      if (msg.includes('Connection was reset') || msg.includes('Connection reset')) {
        return { success: false, pushed: false, error: 'NETWORK_RESET:网络连接被重置，请检查网络或稍后重试', nonFastForward: false };
      }
      if (msg.includes('unable to access') || msg.includes('Could not resolve host')) {
        return { success: false, pushed: false, error: 'NETWORK_UNREACHABLE:无法访问 GitHub，请检查网络连接', nonFastForward: false };
      }
      if (msg.includes('timeout') || msg.includes('timed out')) {
        return { success: false, pushed: false, error: 'NETWORK_TIMEOUT:连接 GitHub 超时，请检查网络或代理设置', nonFastForward: false };
      }
      if (msg.includes('Recv failure')) {
        return { success: false, pushed: false, error: 'NETWORK_RESET:网络连接被重置，请检查网络或稍后重试', nonFastForward: false };
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
