// ============================================================
// GitPilot JetBrains — DeployOrchestrator (Kotlin)
// 
// 架构和 TS 版完全对称：
//   Core 只有接口 → 在这里是 Kotlin 的接口
//   GitHub Provider → 在此项目中实现
//   平台特定 (Git4Idea) → 在此项目中实现
// ============================================================

package com.gitpilot.core

import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.project.Project

// ── 数据类（对应 TS models/）──

enum class DeployStatus { IDLE, BUILDING, STAGING, COMMITTING, PUSHING, RELEASING, SUCCESS, FAILED, NO_CHANGES }

data class DeployStep(
    val name: String,
    var status: String = "pending",
    var error: String? = null,
    var details: String? = null
)

data class DeployResult(
    val success: Boolean,
    val status: DeployStatus,
    val steps: List<DeployStep>,
    val commitHash: String? = null,
    val releaseUrl: String? = null,
    val error: String? = null,
    val durationMs: Long
)

// ── 接口（对应 TS interfaces/）──

interface IRepoProvider {
    val platform: String
    fun listRepos(): List<GitHubRepo>
    fun createRepo(name: String, isPrivate: Boolean): GitHubRepo?
    fun deleteRepo(owner: String, repo: String): Boolean
}

interface IGitProvider {
    fun hasChanges(): Boolean
    fun getStatus(): GitStatus?
    fun stageFiles(): Boolean
    fun commit(message: String): CommitResult
    fun push(): PushResult
    fun pull(): Boolean
    fun getCurrentBranch(): String?
    fun getRemoteUrl(): String?
}

interface IBuildProvider {
    fun run(command: String, indicator: ProgressIndicator): BuildResult
}

// ── 数据类 ──

data class GitHubRepo(val id: Long, val name: String, val fullName: String, val owner: String, val isPrivate: Boolean, val htmlUrl: String, val defaultBranch: String)
data class GitStatus(val isClean: Boolean, val modified: List<String>, val currentBranch: String)
data class CommitResult(val success: Boolean, val hash: String?, val error: String?)
data class PushResult(val success: Boolean, val pushed: Boolean, val error: String?, val nonFastForward: Boolean = false)
data class BuildResult(val success: Boolean, val output: String?, val error: String?, val durationMs: Long)

// ── DeployOrchestrator（对应 TS deploy-orchestrator.ts）──

@Service(Service.Level.PROJECT)
class DeployOrchestrator(private val project: Project) {

    private val logger = Logger.getInstance(DeployOrchestrator::class.java)
    var currentStatus: DeployStatus = DeployStatus.IDLE

    /** 执行完整部署流程 */
    fun deploy(
        indicator: ProgressIndicator,
        repoProvider: IRepoProvider,
        gitProvider: IGitProvider,
        buildProvider: IBuildProvider?,
        buildCommand: String?,
        buildBeforeDeploy: Boolean,
        blockOnBuildFailure: Boolean,
        commitMessage: String = "deploy: auto-deploy by GitPilot"
    ): DeployResult {
        val startTime = System.currentTimeMillis()
        val steps = mutableListOf<DeployStep>()

        try {
            // Step 1: 检查变更
            indicator.text = "检查文件变更..."
            val stepCheck = DeployStep("检查文件变更")
            if (!gitProvider.hasChanges()) {
                stepCheck.status = "skipped"; stepCheck.details = "没有需要部署的变更"; steps.add(stepCheck)
                currentStatus = DeployStatus.NO_CHANGES
                return DeployResult(true, DeployStatus.NO_CHANGES, steps, durationMs = System.currentTimeMillis() - startTime)
            }
            stepCheck.status = "success"; steps.add(stepCheck)

            // Step 2: Build (可选)
            if (buildBeforeDeploy && buildCommand != null && buildProvider != null) {
                indicator.text = "构建项目..."
                val stepBuild = DeployStep("构建项目")
                val result = buildProvider.run(buildCommand, indicator)
                stepBuild.status = if (result.success) "success" else "failed"
                stepBuild.error = result.error; stepBuild.details = result.output?.takeLast(200)
                steps.add(stepBuild)
                if (!result.success && blockOnBuildFailure) {
                    currentStatus = DeployStatus.FAILED
                    return DeployResult(false, DeployStatus.FAILED, steps, error = "Build 失败: ${result.error}", durationMs = System.currentTimeMillis() - startTime)
                }
            }

            // Step 3: Stage
            indicator.text = "暂存文件..."
            val stepStage = DeployStep("暂存文件")
            val staged = gitProvider.stageFiles()
            stepStage.status = if (staged) "success" else "failed"
            if (!staged) stepStage.error = "暂存失败"; steps.add(stepStage)
            if (!staged) return DeployResult(false, DeployStatus.FAILED, steps, error = "暂存失败", durationMs = System.currentTimeMillis() - startTime)
            steps.add(stepStage)

            // Step 4: Commit
            indicator.text = "提交变更..."
            val stepCommit = DeployStep("提交变更")
            val commitResult = gitProvider.commit(commitMessage)
            stepCommit.status = if (commitResult.success) "success" else "failed"
            stepCommit.error = commitResult.error; stepCommit.details = commitResult.hash?.take(7)
            steps.add(stepCommit)
            if (!commitResult.success) return DeployResult(false, DeployStatus.FAILED, steps, error = "提交失败", durationMs = System.currentTimeMillis() - startTime)

            // Step 5: Push
            indicator.text = "推送到 GitHub..."
            val stepPush = DeployStep("推送到 GitHub")
            val pushResult = gitProvider.push()
            stepPush.status = if (pushResult.success) "success" else "failed"
            stepPush.error = pushResult.error; stepPush.details = if (pushResult.pushed) "已推送" else "远端已是最新"
            steps.add(stepPush)
            if (!pushResult.success) {
                val msg = if (pushResult.nonFastForward) "推送冲突：远端有新提交，请先执行 Sync" else "推送失败: ${pushResult.error}"
                return DeployResult(false, DeployStatus.FAILED, steps, commitHash = commitResult.hash, error = msg, durationMs = System.currentTimeMillis() - startTime)
            }

            currentStatus = DeployStatus.SUCCESS
            return DeployResult(true, DeployStatus.SUCCESS, steps, commitHash = commitResult.hash, durationMs = System.currentTimeMillis() - startTime)

        } catch (e: Exception) {
            logger.error("Deploy failed", e)
            currentStatus = DeployStatus.FAILED
            return DeployResult(false, DeployStatus.FAILED, steps, error = e.message, durationMs = System.currentTimeMillis() - startTime)
        }
    }

    fun sync(
        indicator: ProgressIndicator,
        repoProvider: IRepoProvider,
        gitProvider: IGitProvider,
        buildProvider: IBuildProvider?,
        buildCommand: String?,
        buildBeforeDeploy: Boolean,
        blockOnBuildFailure: Boolean
    ): DeployResult {
        indicator.text = "拉取远端更新..."
        gitProvider.pull()
        return deploy(indicator, repoProvider, gitProvider, buildProvider, buildCommand, buildBeforeDeploy, blockOnBuildFailure)
    }
}
