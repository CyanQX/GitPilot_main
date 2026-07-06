// ============================================================
// GitPilot Actions (Kotlin)
// ============================================================

package com.gitpilot.actions

import com.gitpilot.core.*
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.ui.Messages

// ── Deploy ──
class DeployAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val git = project.getService(IntelliJGitProvider::class.java)
        val orch = project.getService(DeployOrchestrator::class.java)
        val settings = GitPilotSettings.instance
        val repoProvider = GitHubRepoProvider(GitPilotSettings.getActiveToken() ?: return)

        ProgressManager.getInstance().runProcessWithProgressSynchronously({
            val result = orch.deploy(it, repoProvider, git, null,
                settings.buildCommand.ifEmpty { null },
                settings.buildBeforeDeploy, settings.blockOnBuildFailure,
                settings.commitMessageTemplate)
            ApplicationManager.getApplication().invokeLater {
                if (result.success) Messages.showInfoMessage(project, "🚀 部署成功！", "GitPilot")
                else Messages.showErrorDialog(project, "部署失败: ${result.error}", "GitPilot")
            }
        }, "GitPilot 部署中...", true, project)
    }
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null && GitPilotSettings.getActiveToken() != null
    }
}

// ── Sync ──
class SyncAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val git = project.getService(IntelliJGitProvider::class.java)
        val orch = project.getService(DeployOrchestrator::class.java)
        val settings = GitPilotSettings.instance
        val repoProvider = GitHubRepoProvider(GitPilotSettings.getActiveToken() ?: return)

        ProgressManager.getInstance().runProcessWithProgressSynchronously({
            val result = orch.sync(it, repoProvider, git, null,
                settings.buildCommand.ifEmpty { null },
                settings.buildBeforeDeploy, settings.blockOnBuildFailure)
            ApplicationManager.getApplication().invokeLater {
                if (result.success) Messages.showInfoMessage(project, "🔄 同步完成！", "GitPilot")
                else Messages.showErrorDialog(project, "同步失败: ${result.error}", "GitPilot")
            }
        }, "GitPilot 同步中...", true, project)
    }
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null && GitPilotSettings.getActiveToken() != null
    }
}

// ── Login ──
class LoginAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val token = Messages.showPasswordDialog(project, "输入 GitHub Personal Access Token", "GitPilot Login", null)
        if (token.isNullOrEmpty()) return
        val rp = GitHubRepoProvider(token)
        if (!rp.validateToken()) { Messages.showErrorDialog(project, "Token 无效", "GitPilot"); return }
        val user = rp.getCurrentUser()
        GitPilotSettings.saveToken(user ?: "unknown", token)
        GitPilotSettings.instance.activeAccount = user ?: "unknown"
        Messages.showInfoMessage(project, "✅ 已登录: $user", "GitPilot")
    }
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = GitPilotSettings.getActiveToken() == null
    }
}

// ── Logout ──
class LogoutAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        if (Messages.showYesNoDialog(project, "确定登出？", "GitPilot", Messages.getWarningIcon()) == Messages.YES) {
            val login = GitPilotSettings.instance.activeAccount
            if (login.isNotEmpty()) GitPilotSettings.deleteToken(login)
            GitPilotSettings.instance.activeAccount = ""
            Messages.showInfoMessage(project, "已登出", "GitPilot")
        }
    }
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = GitPilotSettings.getActiveToken() != null
    }
}

// ── Configure Build ──
class ConfigureBuildAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val settings = GitPilotSettings.instance
        val cmd = Messages.showInputDialog(project, "输入构建命令\n(不猜测语言，你自己写)", "GitPilot", null, settings.buildCommand, null)
        if (cmd == null) return
        val beforeDeploy = Messages.showYesNoDialog(project, "部署前执行 Build？", "GitPilot", Messages.getQuestionIcon())
        val blockOnFail = Messages.showYesNoDialog(project, "Build 失败时阻止部署？", "GitPilot", Messages.getQuestionIcon())
        settings.buildCommand = cmd
        settings.buildBeforeDeploy = beforeDeploy == Messages.YES
        settings.blockOnBuildFailure = blockOnFail == Messages.YES
        Messages.showInfoMessage(project, "✅ 构建配置已更新", "GitPilot")
    }
}
