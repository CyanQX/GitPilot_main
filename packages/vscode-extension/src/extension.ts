// ============================================================
// GitPilot VS Code Extension — 入口
//
// 架构：
//   Core (接口) ← Provider (GitHub 实现)
//   Core (接口) ← VSCode Provider (平台特定实现)
//   Core (DeployOrchestrator) ← 全部 Provider
//
// Core 不知道 VS Code，不知道 GitHub。
// ============================================================

import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import {
  DeployOrchestrator,
  TokenManager,
  SmartFilter,
  Logger,
} from '@gitpilot/core';
import type { DeployResult, DeployConfig } from '@gitpilot/core';
import {
  GitHubRepositoryProvider,
  GitHubAuthProvider,
  GitHubReleaseProvider,
} from '@gitpilot/provider-github';
import { VSCodeGitProvider } from './providers/vscode-git-provider';
import { VSCodeBuildProvider } from './providers/vscode-build-provider';
import { VSCodeNotificationProvider } from './providers/vscode-notification-provider';
import { VSCodeSecretStorage } from './providers/vscode-secret-storage';
import { VSCodeFileWatcherProvider } from './providers/vscode-file-watcher-provider';
import { SidebarProvider } from './ui/sidebar-provider';
import { promptBrowserSelection, performBrowserOAuth } from './providers/browser-auth-handler';

// ---- 全局状态 ----
let orchestrator: DeployOrchestrator | null = null;
let tokenManager: TokenManager;
let repoProvider: GitHubRepositoryProvider;
let authProvider: GitHubAuthProvider;
let releaseProvider: GitHubReleaseProvider;
let gitProvider: VSCodeGitProvider;
let notifier: VSCodeNotificationProvider;
let fileWatcher: VSCodeFileWatcherProvider;
let sidebarProvider: SidebarProvider;
let octokit: Octokit | null = null;
let scheduledTimer: ReturnType<typeof setInterval> | null = null;

const logger = new Logger('VSCode');
const OAUTH_CLIENT_ID = 'your-github-oauth-app-client-id'; // TODO: 替换

// ---- 激活 ----
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    logger.info('GitPilot 正在激活...');

    // 初始化平台特定 Provider
    const secretStorage = new VSCodeSecretStorage(context.secrets);
    tokenManager = new TokenManager(secretStorage);
    notifier = new VSCodeNotificationProvider();

    // 初始化 GitHub Provider（Token 稍后注入）
    octokit = new Octokit();
    repoProvider = new GitHubRepositoryProvider(octokit);
    authProvider = new GitHubAuthProvider(OAUTH_CLIENT_ID);
    releaseProvider = new GitHubReleaseProvider(octokit);

    // 注册侧边栏
    sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('gitpilot-main', sidebarProvider),
    );

    // 注册命令
    registerCommands(context);

    // 自动恢复登录
    await autoRestoreSession(context);

    // 自动部署触发器
    initializeAutoDeploy(context);

    logger.info('GitPilot 已激活 ✓');
    vscode.window.showInformationMessage('🚀 GitPilot 已就绪！点左侧图标开始使用');
  } catch (e: any) {
    logger.error('激活失败: ' + e.message);
    vscode.window.showErrorMessage('GitPilot 启动失败: ' + e.message);
  }
}

export async function deactivate(): Promise<void> {
  const config = vscode.workspace.getConfiguration('gitpilot');
  if (config.get<boolean>('autoDeploy.onExit') && orchestrator) {
    try { await orchestrator.deploy(); } catch { /* 非关键 */ }
  }
  if (scheduledTimer) clearInterval(scheduledTimer);
  logger.info('GitPilot 已停用');
}

// ---- 命令注册 ----
function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.deploy', handleDeploy));
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.sync', handleSync));
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.login', handleLogin));
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.logout', handleLogout));
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.switchAccount', handleSwitchAccount));
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.createRepo', handleCreateRepo));
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.switchRepo', handleSwitchRepo));
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.refreshRepos', handleRefreshRepos));
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.refreshStatus', handleRefreshStatus));
  context.subscriptions.push(vscode.commands.registerCommand('gitpilot.configureBuild', handleConfigureBuild));
}

// ---- 命令处理 ----
async function handleDeploy(): Promise<void> {
  try {
  if (!orchestrator) { vscode.window.showWarningMessage('请先登录 GitHub'); return; }
  if (!(await orchestrator.hasPendingChanges())) {
    vscode.window.showInformationMessage('✅ 没有需要部署的变更');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'GitPilot 部署中...', cancellable: true },
    async (progress, token) => {
      const result = await orchestrator!.deploy();
      if (!token.isCancellationRequested) showDeployResult(result);
    },
  );
  } catch (e: any) { vscode.window.showErrorMessage(`部署异常: ${e.message}`); logger.error('Deploy error: ' + e.message); }
}

async function handleSync(): Promise<void> {
  try {
  if (!orchestrator) { vscode.window.showWarningMessage('请先登录 GitHub'); return; }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'GitPilot 同步中...' },
    async () => { const r = await orchestrator!.sync(); showDeployResult(r); },
  );
  } catch (e: any) { vscode.window.showErrorMessage(`同步异常: ${e.message}`); }
}

async function handleLogin(): Promise<void> {
  try {
    // ---- 选择登录方式 ----
    const method = await vscode.window.showQuickPick(
      [
        {
          label: '🔐 浏览器 OAuth 登录',
          description: '✨ 推荐',
          detail: '自动打开浏览器完成 GitHub 授权，安全便捷',
        },
        {
          label: '🔑 Personal Access Token',
          description: '手动输入',
          detail: '使用 GitHub Personal Access Token 登录（需要 repo + workflow 权限）',
        },
      ],
      { placeHolder: '选择 GitHub 登录方式', title: 'GitPilot · 登录 GitHub' },
    );

    if (!method) return;

    if (method.label.includes('Token')) {
      await loginWithPAT();
    } else {
      await loginWithBrowserOAuth();
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(`登录失败: ${e.message}`);
    logger.error('Login error: ' + e.message + '\n' + e.stack);
  }
}

// ---- PAT 登录（保留原有流程） ----
async function loginWithPAT(): Promise<void> {
  const token = await vscode.window.showInputBox({
    prompt: '输入 GitHub Personal Access Token\n（需要 repo + workflow 权限）\n创建: https://github.com/settings/tokens',
    password: true,
    placeHolder: 'ghp_xxxxxxxxxxxx',
    ignoreFocusOut: true,
  });
  if (!token) { vscode.window.showWarningMessage('已取消登录'); return; }

  vscode.window.showInformationMessage('正在验证 Token...');
  const isValid = await authProvider.validateToken(token);
  if (!isValid) { vscode.window.showErrorMessage('Token 无效，请检查权限是否包含 repo 和 workflow'); return; }

  const user = await authProvider.getUserInfo(token);
  await tokenManager.save(user.login, token, 'github');

  await completeLogin(token, user.login, user.avatarUrl ?? undefined);
}

// ---- 浏览器 OAuth 登录（新流程） ----
async function loginWithBrowserOAuth(): Promise<void> {
  // 1. 弹出浏览器选择面板
  const browser = await promptBrowserSelection();
  if (browser === undefined) return; // 用户取消选择

  // 2. 构建 OAuth 授权 URL（先用默认 redirect_uri 生成，后面会替换端口）
  const authUrl = authProvider.getAuthorizationUrl();

  // 3. 执行浏览器 OAuth 流程（内部启动本地服务器 + 打开浏览器 + 等待回调）
  const browserName = browser ? browser.name : '系统默认浏览器';
  vscode.window.showInformationMessage(`正在用 ${browserName} 打开 GitHub 授权页面...`);

  const code = await performBrowserOAuth(authUrl, browser);

  // 4. 用授权码换取 Token
  vscode.window.showInformationMessage('正在获取访问令牌...');
  const authToken = await authProvider.exchangeCodeForToken(code);

  // 5. 验证并获取用户信息
  const user = await authProvider.getUserInfo(authToken.accessToken);
  await tokenManager.save(user.login, authToken.accessToken, 'github');

  await completeLogin(authToken.accessToken, user.login, user.avatarUrl ?? undefined);
}

// ---- 登录完成后的统一处理 ----
async function completeLogin(token: string, login: string, avatarUrl?: string): Promise<void> {
  octokit = new Octokit({ auth: token });
  repoProvider = new GitHubRepositoryProvider(octokit);
  releaseProvider = new GitHubReleaseProvider(octokit);

  await initOrchestrator();
  vscode.commands.executeCommand('setContext', 'gitpilot:loggedIn', true);
  vscode.window.showInformationMessage(`✅ 已登录: ${login}`);
  sidebarProvider.setLoggedIn(login, avatarUrl);
}

async function handleLogout(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage('确定登出？', { modal: true }, '登出');
  if (confirm !== '登出') return;
  await tokenManager.clearAll();
  orchestrator = null;
  vscode.commands.executeCommand('setContext', 'gitpilot:loggedIn', false);
  vscode.window.showInformationMessage('已登出');
  sidebarProvider.setLoggedOut();
}

async function handleSwitchAccount(): Promise<void> {
  const accounts = await tokenManager.getAccounts();
  if (accounts.length === 0) { vscode.window.showInformationMessage('无已保存账号'); return; }
  const items = accounts.map((a) => ({ label: a.login, description: `${a.platform} · ${new Date(a.lastUsedAt).toLocaleDateString()}` }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: '选择账号' });
  if (!picked) return;
  await tokenManager.switchTo(picked.label);
  const token = await tokenManager.get(picked.label);
  if (token) {
    octokit = new Octokit({ auth: token });
    repoProvider = new GitHubRepositoryProvider(octokit);
    releaseProvider = new GitHubReleaseProvider(octokit);
    await initOrchestrator();
  }
  vscode.window.showInformationMessage(`已切换: ${picked.label}`);
}

async function handleCreateRepo(): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: '仓库名称', placeHolder: 'my-project' });
  if (!name) return;
  const priv = await vscode.window.showQuickPick(['公开', '私有'], { placeHolder: '可见性' });
  if (!priv) return;
  try {
    const repo = await repoProvider.createRepo({ name, private: priv === '私有', autoInit: true });
    vscode.window.showInformationMessage(`✅ 已创建: ${repo.fullName}`);
  } catch (e: any) { vscode.window.showErrorMessage(`创建失败: ${e.message}`); }
}

async function handleSwitchRepo(): Promise<void> {
  try {
    const repos = await repoProvider.listRepos();
    const items = repos.map((r) => ({
      label: r.fullName,
      description: r.private ? '🔒 Private' : '🌐 Public',
      detail: r.description ?? undefined,
    }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: '选择仓库', matchOnDescription: true });
    if (picked) { vscode.window.showInformationMessage(`当前仓库: ${picked.label}`); }
  } catch (e: any) { vscode.window.showErrorMessage(`获取失败: ${e.message}`); }
}

async function handleRefreshRepos(): Promise<void> {
  try {
    const repos = await repoProvider.listRepos();
    vscode.window.showInformationMessage(`找到 ${repos.length} 个仓库`);
  } catch (e: any) { vscode.window.showErrorMessage(`刷新失败: ${e.message}`); }
}

// ⭐ 真实刷新状态（3-7s 随机延迟 + 10s 超时）
async function handleRefreshStatus(): Promise<void> {
  // 通知侧边栏开始加载动画
  sidebarProvider.postMessage({ refreshState: 'start' });

  // 根据网络速度模拟 3-7 秒随机延迟
  const networkDelay = Math.floor(Math.random() * 4000) + 3000; // 3000~7000ms
  const timeoutMs = 10000; // 10 秒超时

  try {
    const result = await Promise.race([
      (async () => {
        // 模拟网络延迟
        await new Promise(r => setTimeout(r, networkDelay));

        // 实际刷新操作：获取仓库列表 + Git 状态
        const repos = await repoProvider.listRepos();
        let gitStatusInfo = '';
        try {
          if (orchestrator) {
            const hasChanges = await orchestrator.hasPendingChanges();
            gitStatusInfo = hasChanges ? ' · 有未部署变更' : ' · 已是最新';
          }
        } catch { /* git status 非关键 */ }

        return { repos, gitStatusInfo };
      })(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('TIMEOUT')), timeoutMs)
      ),
    ]);

    // 刷新成功
    const statusMsg = `已同步 ${result.repos.length} 个仓库${result.gitStatusInfo}`;
    sidebarProvider.postMessage({
      refreshState: 'done',
      statusText: statusMsg,
      status: '✅ 就绪',
    });
  } catch (e: any) {
    // 超时或错误
    logger.error('Refresh error: ' + (e.message ?? String(e)));
    sidebarProvider.postMessage({
      refreshState: 'error',
      statusText: '报错！请检查网络是否正常',
      status: '❌ 刷新失败',
    });
  }
}

async function handleConfigureBuild(): Promise<void> {
  const config = vscode.workspace.getConfiguration('gitpilot');
  const cmd = await vscode.window.showInputBox({
    prompt: '输入构建命令（不猜测语言，你自己写）',
    placeHolder: 'npm run build / cargo build --release / ...',
    value: config.get<string>('build.command') ?? '',
  });
  if (cmd === undefined) return;
  const beforeDeploy = await vscode.window.showQuickPick(['是', '否'], { placeHolder: '部署前执行 Build？' });
  const blockOnFail = await vscode.window.showQuickPick(['是', '否'], { placeHolder: 'Build 失败时阻止部署？' });
  await config.update('build.command', cmd, vscode.ConfigurationTarget.Workspace);
  await config.update('build.beforeDeploy', beforeDeploy === '是', vscode.ConfigurationTarget.Workspace);
  await config.update('build.blockOnFailure', blockOnFail === '是', vscode.ConfigurationTarget.Workspace);
  vscode.window.showInformationMessage('✅ 构建配置已更新');
}

// ---- 部署结果展示 ----
function showDeployResult(result: DeployResult): void {
  if (result.success && result.status === 'no-changes') return;
  if (result.success) {
    notifier.show({
      type: 'success', title: '🚀 部署成功！',
      message: `提交: ${result.commitHash?.substring(0, 7) ?? '--'} · 耗时 ${(result.totalDurationMs / 1000).toFixed(1)}s`,
      actions: [
        { label: '在 GitHub 上查看', id: 'open-repo' },
        ...(result.releaseUrl ? [{ label: '查看 Release', id: 'open-release' }] : []),
      ],
    });
  } else {
    notifier.show({
      type: 'error', title: '❌ 部署失败',
      message: result.error ?? '未知错误',
      actions: [{ label: '重试', id: 'retry' }],
    });
  }
}

// ---- 初始化 Orchestrator ----
async function initOrchestrator(): Promise<void> {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsRoot) { logger.warn('未打开工作区'); return; }

  const config = vscode.workspace.getConfiguration('gitpilot');
  gitProvider = new VSCodeGitProvider(wsRoot);
  const buildProvider = new VSCodeBuildProvider();
  const smartFilter = new SmartFilter(wsRoot, {
    blockSecrets: config.get<boolean>('security.blockSecrets'),
  });

  // ⭐ 智能检测当前分支：先查当前分支，失败则列本地分支取第一个
  let branch = 'main';
  try {
    const b = await gitProvider.getCurrentBranch();
    if (b && b !== 'HEAD') branch = b;
  } catch {
    // getCurrentBranch 失败，尝试回退
    try {
      const status = await gitProvider.getStatus();
      if (status.currentBranch && status.currentBranch !== 'HEAD' && status.currentBranch !== 'unknown') {
        branch = status.currentBranch;
      }
    } catch { /* 保持 main 作为默认值 */ }
  }

  const remoteUrl = await gitProvider.getRemoteUrl().catch(() => null);
  const repoName = parseRepoFromUrl(remoteUrl);

  // ⭐ 更新侧边栏仓库信息
  if (repoName) {
    sidebarProvider.setRepoName(repoName.fullName);
  }
  const buildCmd = config.get<string>('build.command');
  if (buildCmd) {
    sidebarProvider.setBuildCmd(buildCmd);
  }

  const deployConfig: DeployConfig = {
    repo: { owner: repoName?.owner ?? 'unknown', name: repoName?.name ?? 'unknown', fullName: repoName ? `${repoName.owner}/${repoName.name}` : 'unknown' },
    branch,
    trigger: 'manual',
    commitMessageTemplate: config.get<string>('commit.messageTemplate') ?? 'deploy: auto-deploy by GitPilot',
    buildCommand: config.get<string>('build.command') || undefined,
    buildBeforeDeploy: config.get<boolean>('build.beforeDeploy'),
    blockOnBuildFailure: config.get<boolean>('build.blockOnFailure'),
    release: config.get<boolean>('release.enabled') ? {
      enabled: true,
      artifactPaths: config.get<string[]>('release.artifactPaths'),
    } : undefined,
  };

  orchestrator = new DeployOrchestrator(
    deployConfig, repoProvider, gitProvider, buildProvider, releaseProvider, notifier, smartFilter,
  );
}

// ---- 自动登录恢复 ----
async function autoRestoreSession(context: vscode.ExtensionContext): Promise<void> {
  const token = await tokenManager.getActive();
  if (!token) { vscode.commands.executeCommand('setContext', 'gitpilot:loggedIn', false); return; }

  const isValid = await authProvider.validateToken(token);
  if (!isValid) {
    await tokenManager.clearAll();
    vscode.commands.executeCommand('setContext', 'gitpilot:loggedIn', false);
    return;
  }

  octokit = new Octokit({ auth: token });
  repoProvider = new GitHubRepositoryProvider(octokit);
  releaseProvider = new GitHubReleaseProvider(octokit);
  await initOrchestrator();
  vscode.commands.executeCommand('setContext', 'gitpilot:loggedIn', true);
  logger.info('Session 已恢复');
  // 获取用户名用于侧边栏显示
  try {
    const user = await authProvider.getUserInfo(token);
    sidebarProvider.setLoggedIn(user.login, user.avatarUrl ?? undefined);
  } catch {
    sidebarProvider.setLoggedIn('GitHub');
  }
}

// ---- 自动部署触发器 ----
function initializeAutoDeploy(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('gitpilot');

  if (config.get<boolean>('autoDeploy.onSave')) {
    const delay = (config.get<number>('autoDeploy.onSaveDelay') ?? 3) * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => { if (orchestrator) await orchestrator.deploy(); }, delay);
    }));
  }

  if (config.get<boolean>('autoDeploy.scheduled')) {
    const interval = parseInterval(config.get<string>('autoDeploy.scheduledInterval') ?? '30min');
    scheduledTimer = setInterval(async () => {
      if (orchestrator && await orchestrator.hasPendingChanges()) {
        await orchestrator.deploy();
      }
    }, interval);
  }
}

// ---- 辅助函数 ----
function parseRepoFromUrl(url: string | null): { owner: string; name: string } | null {
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  return m ? { owner: m[1], name: m[2] } : null;
}

function parseInterval(s: string): number {
  const map: Record<string, number> = {
    '10min': 600000, '30min': 1800000, '1h': 3600000,
    '2h': 7200000, '4h': 14400000, 'daily': 86400000,
  };
  return map[s] ?? 1800000;
}
