// ============================================================
// IntelliJGitProvider (Kotlin) — 实现 IGitProvider
// 基于 Git4Idea（IntelliJ 内置 Git 集成）
// 对应 TS vscode-extension/providers/vscode-git-provider.ts
// ============================================================

package com.gitpilot.core

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import git4idea.GitUtil
import git4idea.commands.*
import git4idea.repo.GitRepositoryManager

@Service(Service.Level.PROJECT)
class IntelliJGitProvider(private val project: Project) : IGitProvider {

    private val git = Git.getInstance()

    private fun getRepo() = GitRepositoryManager.getInstance(project).repositories.firstOrNull()

    override fun hasChanges(): Boolean {
        val repo = getRepo() ?: return false
        val status = GitUtil.getStatus(project, repo.root)
        return !(status.modified.isEmpty() && status.added.isEmpty() && status.removed.isEmpty() && status.untracked.isEmpty())
    }

    override fun getStatus(): GitStatus? {
        val repo = getRepo() ?: return null
        val s = GitUtil.getStatus(project, repo.root)
        return GitStatus(
            isClean = s.modified.isEmpty() && s.added.isEmpty(),
            modified = s.modified,
            currentBranch = repo.currentBranch?.name ?: "unknown"
        )
    }

    override fun stageFiles(): Boolean {
        val repo = getRepo() ?: return false
        return try {
            val handler = GitLineHandler(project, repo.root, GitCommand.ADD)
            handler.addAbsoluteFile(repo.root.absolutePath)
            git.runCommand(handler).success()
        } catch (e: Exception) { false }
    }

    override fun commit(message: String): CommitResult {
        val repo = getRepo() ?: return CommitResult(false, null, "No repo")
        return try {
            val handler = GitLineHandler(project, repo.root, GitCommand.COMMIT)
            handler.addParameters("-m", message)
            val result = git.runCommand(handler)
            CommitResult(result.success(), repo.currentRevision?.take(7), result.errorOutputAsJoinedString)
        } catch (e: Exception) { CommitResult(false, null, e.message) }
    }

    override fun push(): PushResult {
        val repo = getRepo() ?: return PushResult(false, false, "No repo")
        // Fetch first
        try {
            val fetchHandler = GitLineHandler(project, repo.root, GitCommand.FETCH)
            fetchHandler.addParameters("--all")
            git.runCommand(fetchHandler)
        } catch (_: Exception) {}

        // Check behind
        val info = repo.currentBranch?.trackingInfo
        if (info != null && info.behind > 0) {
            return PushResult(false, false, "远端有 ${info.behind} 个新提交", nonFastForward = true)
        }

        return try {
            val handler = GitLineHandler(project, repo.root, GitCommand.PUSH)
            val result = git.runCommand(handler)
            PushResult(result.success(), !result.errorOutputAsJoinedString.contains("up-to-date"), result.errorOutputAsJoinedString)
        } catch (e: Exception) { PushResult(false, false, e.message, e.message?.contains("non-fast-forward") == true) }
    }

    override fun pull(): Boolean {
        val repo = getRepo() ?: return false
        return try {
            val handler = GitLineHandler(project, repo.root, GitCommand.PULL)
            git.runCommand(handler).success()
        } catch (e: Exception) { false }
    }

    override fun getCurrentBranch(): String? = getRepo()?.currentBranch?.name
    override fun getRemoteUrl(): String? = getRepo()?.remotes?.firstOrNull()?.firstUrl
}
