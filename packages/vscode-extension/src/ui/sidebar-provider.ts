// GitPilot Sidebar — WebView Provider（支持登录状态持久化）
// ============================================================
import * as vscode from 'vscode';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _isLoggedIn = false;
  private _loginName = '';
  private _repoName = '';
  private _buildCmd = '';
  private _status = '未登录';
  private _statusText = '刷新后同步仓库、部署与构建状态';

  private _avatarUrl = '';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true, // ⭐ 切换标签页不销毁 webview
    };
    webviewView.webview.html = this.getHtml();

    // webview 就绪后，立即发送当前状态
    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.command) {
        case 'deploy':   vscode.commands.executeCommand('gitpilot.deploy'); break;
        case 'sync':     vscode.commands.executeCommand('gitpilot.sync'); break;
        case 'login':    vscode.commands.executeCommand('gitpilot.login'); break;
        case 'logout':   vscode.commands.executeCommand('gitpilot.logout'); break;
        case 'createRepo':  vscode.commands.executeCommand('gitpilot.createRepo'); break;
        case 'switchRepo':  vscode.commands.executeCommand('gitpilot.switchRepo'); break;
        case 'refreshRepos': vscode.commands.executeCommand('gitpilot.refreshStatus'); break;
        case 'configureBuild': vscode.commands.executeCommand('gitpilot.configureBuild'); break;
        case 'getState':
          // ⭐ webview 请求当前状态 → 立即恢复
          this._pushState();
          break;
      }
    });

    // ⭐ 如果已登录，立即恢复状态（处理 webview 重建场景）
    if (this._isLoggedIn) {
      this._pushState();
    }
  }

  refresh(): void {
    if (this._view) {
      this._view.webview.html = this.getHtml();
      // ⭐ 重建 HTML 后立即恢复状态
      if (this._isLoggedIn) {
        // 需要等 webview 加载完再发消息
        setTimeout(() => this._pushState(), 100);
      }
    }
  }

  /** ⭐ 推送当前完整状态到 webview */
  private _pushState(): void {
    if (!this._view) return;
    this._view.webview.postMessage({
      loggedIn: this._isLoggedIn,
      loginName: this._loginName,
      avatarUrl: this._avatarUrl,
      repoName: this._repoName,
      buildCmd: this._buildCmd,
      status: this._status,
      statusText: this._statusText,
    });
  }

  /** ⭐ 设置已登录状态 */
  setLoggedIn(login: string, avatarUrl?: string): void {
    this._isLoggedIn = true;
    this._loginName = login;
    this._avatarUrl = avatarUrl ?? '';
    this._status = '✅ 就绪';
    this._statusText = '刷新后同步仓库、部署与构建状态';
    this._pushState();
  }

  /** ⭐ 设置已登出状态 */
  setLoggedOut(): void {
    this._isLoggedIn = false;
    this._loginName = '';
    this._repoName = '';
    this._buildCmd = '';
    this._status = '未登录';
    this._statusText = '请先登录 GitHub 账号';
    this._pushState();
  }

  /** ⭐ 更新仓库名称 */
  setRepoName(name: string): void {
    this._repoName = name;
    this._pushState();
  }

  /** ⭐ 更新构建命令 */
  setBuildCmd(cmd: string): void {
    this._buildCmd = cmd;
    this._pushState();
  }

  /** ⭐ 更新状态文本 */
  setStatus(status: string, statusText?: string): void {
    this._status = status;
    if (statusText !== undefined) this._statusText = statusText;
    this._pushState();
  }

  // ---- 兼容旧 API（外部仍然可以用 postMessage） ----
  postMessage(msg: any): void {
    // 更新内部状态
    if (msg.loggedIn !== undefined) {
      this._isLoggedIn = msg.loggedIn;
      if (msg.loggedIn) {
        this._status = msg.status ?? '✅ 就绪';
      }
    }
    if (msg.repoName !== undefined) this._repoName = msg.repoName;
    if (msg.buildCmd !== undefined) this._buildCmd = msg.buildCmd;
    if (msg.status !== undefined) this._status = msg.status;

    this._view?.webview.postMessage(msg);
  }

  // ---- HTML ----
  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${vscode.Uri.parse('').scheme}: https: data:; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
  :root{
    --bg:var(--vscode-sideBar-background);
    --fg:var(--vscode-sideBar-foreground);
    --btn:var(--vscode-button-background);
    --btn-fg:var(--vscode-button-foreground);
    --btn-hover:var(--vscode-button-hoverBackground);
    --input-bg:var(--vscode-input-background);
    --input-border:var(--vscode-input-border);
    --desc:var(--vscode-descriptionForeground);
    --accent:#58a6ff;
    --green:#3fb950;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--vscode-font-family);font-size:13px;color:var(--fg);padding:0;background:var(--bg)}

  /* ── 账号卡片 ── */
  .account-card{
    display:flex;align-items:center;gap:10px;
    padding:12px 14px;margin:10px;border-radius:8px;
    background:linear-gradient(135deg,#1a2332 0%,#162030 100%);
    border:1px solid #30363d;
  }
  .avatar{
    width:40px;height:40px;border-radius:50%;background:#30363d;
    display:flex;align-items:center;justify-content:center;
    font-size:18px;flex-shrink:0;overflow:hidden;
  }
  .avatar img{width:40px;height:40px;border-radius:50%;display:block}
  .account-info{flex:1;min-width:0}
  .account-name{font-size:14px;font-weight:700;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .account-desc{font-size:11px;color:#8b949e;margin-top:1px}
  .btn-logout{
    padding:4px 10px;border-radius:4px;border:1px solid #f8514933;
    background:transparent;color:#f85149;font-size:11px;cursor:pointer;font-family:inherit;
    flex-shrink:0;
  }
  .btn-logout:hover{background:#f851491a}

  /* ── 仓库选择区 ── */
  .repo-card{
    margin:0 10px 10px;padding:8px 12px;border-radius:6px;
    background:var(--input-bg);border:1px solid var(--input-border);
  }
  .repo-row{display:flex;align-items:center;justify-content:space-between}
  .repo-label{font-size:10px;font-weight:600;color:var(--desc);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
  .repo-name{font-size:13px;font-weight:600;color:var(--accent)}
  .repo-badge{font-size:10px;padding:2px 6px;border-radius:10px;background:#30363d;color:#8b949e;margin-left:6px}

  /* ── 操作按钮区 ── */
  .action-area{margin:0 10px 10px}
  .action-row{display:flex;gap:8px}
  .btn-deploy{
    flex:1;padding:10px;border:none;border-radius:6px;
    font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;
    background:linear-gradient(135deg,#238636,#2ea043);color:#fff;
    box-shadow:0 1px 3px rgba(0,0,0,.3);
    transition:opacity .15s;
  }
  .btn-deploy:hover{opacity:.9}
  .btn-sync{
    padding:10px 16px;border:none;border-radius:6px;
    font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;
    background:var(--input-bg);color:var(--fg);
    border:1px solid var(--input-border);
  }
  .btn-sync:hover{background:var(--btn-hover)}

  /* ── 构建命令区 ── */
  .build-card{
    margin:0 10px 10px;padding:8px 12px;border-radius:6px;
    background:var(--input-bg);border:1px solid var(--input-border);
  }
  .build-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
  .build-label{font-size:10px;font-weight:600;color:var(--desc);text-transform:uppercase;letter-spacing:0.5px}
  .build-cmd{font-size:12px;color:#8b949e;font-family:var(--vscode-editor-font-family);word-break:break-all}

  /* ── 仓库管理区 ── */
  .mgmt-area{margin:0 10px 10px}
  .mgmt-row{display:flex;gap:6px}
  .btn-mgmt{
    flex:1;padding:6px 8px;border-radius:4px;border:1px solid var(--input-border);
    background:transparent;color:var(--fg);font-size:11px;font-family:inherit;cursor:pointer;
    text-align:center;
  }
  .btn-mgmt:hover{background:var(--input-bg)}

  /* ── 状态栏 ── */
  .status-bar{
    margin:0 10px 10px;padding:6px 10px;border-radius:4px;
    background:#1a2332;border:1px solid #30363d;
    display:flex;align-items:center;gap:6px;font-size:11px;
  }
  .status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .status-dot.ok{background:var(--green)}
  .status-dot.off{background:#f85149}
  .status-dot.loading{background:#d29922;animation:pulse 1s infinite}
  .status-text{color:#8b949e}

  /* ── 分割线 ── */
  .divider{height:1px;background:var(--input-border);margin:8px 10px}

  /* ── 登录按钮 ── */
  .login-area{padding:10px}
  .btn-login-full{
    display:flex;align-items:center;justify-content:center;gap:8px;
    width:calc(100% - 20px);margin:10px;padding:12px;border:none;border-radius:8px;
    font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;
    background:linear-gradient(135deg,#238636,#2ea043);color:#fff;
    box-shadow:0 2px 6px rgba(0,0,0,.3);
  }
  .btn-login-full:hover{opacity:.9}
  .github-icon{width:20px;height:20px}

  .btn-icon{
    padding:2px 6px;border-radius:3px;border:1px solid var(--input-border);
    background:transparent;color:var(--desc);font-size:10px;cursor:pointer;font-family:inherit;
    transition:transform .3s;
  }
  .btn-icon:hover{color:var(--fg);background:var(--input-bg)}
  .btn-icon.spinning{animation:spin 1s linear infinite;color:var(--accent);pointer-events:none}

  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

  .hidden{display:none !important}
</style></head>
<body>

<!-- ════ 未登录状态 ════ -->
<div id="panel-logged-out">
  <div class="login-area">
    <button class="btn-login-full" id="btn-login">
      <svg class="github-icon" viewBox="0 0 16 16" fill="white"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Login with GitHub
    </button>
  </div>
</div>

<!-- ════ 已登录状态 ════ -->
<div id="panel-logged-in" class="hidden">

  <!-- 账号卡片 -->
  <div class="account-card">
    <div class="avatar" id="avatar-area">
      <span id="avatar-text" style="font-size:18px">🐱</span>
      <img id="avatar-img" src="" style="display:none" alt="">
    </div>
    <div class="account-info">
      <div class="account-name" id="account-name">GitHub</div>
      <div class="account-desc">github账号昵称显示位置</div>
    </div>
    <button class="btn-logout" id="btn-logout">登出</button>
  </div>

  <!-- 仓库选择 -->
  <div class="repo-card">
    <div class="repo-label">📦 当前仓库</div>
    <div class="repo-row">
      <div>
        <span class="repo-name" id="repo-name">--</span>
        <span class="repo-badge" id="repo-badge" style="display:none">Public</span>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn-icon" id="btn-switchRepo" title="切换仓库">🔄</button>
        <button class="btn-icon" id="btn-refreshRepos" title="刷新状态">🔃</button>
      </div>
    </div>
  </div>

  <!-- 操作按钮 -->
  <div class="action-area">
    <div class="action-row">
      <button class="btn-deploy" id="btn-deploy">🚀 Deploy</button>
      <button class="btn-sync" id="btn-sync">🔄 Sync</button>
    </div>
  </div>

  <!-- 构建命令 -->
  <div class="build-card">
    <div class="build-header">
      <span class="build-label">🔨 构建命令</span>
      <button class="btn-icon" id="btn-configureBuild" title="配置构建命令">⚙️</button>
    </div>
    <div class="build-cmd" id="build-cmd">未配置</div>
  </div>

  <div class="divider"></div>

  <!-- 仓库管理 -->
  <div class="mgmt-area">
    <div class="mgmt-row">
      <button class="btn-mgmt" id="btn-createRepo">+ 创建仓库</button>
    </div>
  </div>

  <div class="divider"></div>

  <!-- 状态栏 -->
  <div class="status-bar">
    <span class="status-dot ok" id="status-dot"></span>
    <span class="status-text" id="status-text">刷新后同步仓库、部署与构建状态</span>
    <span style="margin-left:auto;color:var(--green);font-weight:600" id="status-label">就绪</span>
  </div>
</div>

<script>
(function(){
  var vscode = acquireVsCodeApi();
  function send(cmd){ vscode.postMessage({command:cmd}); }

  // 绑定按钮
  function bind(id, cmd){
    var el = document.getElementById(id);
    if(el) el.addEventListener('click', function(){ send(cmd); });
  }
  bind('btn-login', 'login');
  bind('btn-deploy', 'deploy');
  bind('btn-sync', 'sync');
  bind('btn-logout', 'logout');
  bind('btn-switchRepo', 'switchRepo');
  bind('btn-createRepo', 'createRepo');
  bind('btn-refreshRepos', 'refreshRepos');
  bind('btn-configureBuild', 'configureBuild');

  // ⭐ 渲染已登录 UI
  function renderLoggedIn(loginName, avatarUrl) {
    document.getElementById('panel-logged-out').classList.add('hidden');
    document.getElementById('panel-logged-in').classList.remove('hidden');
    var nameDisplay = loginName || 'GitHub';
    document.getElementById('account-name').textContent = nameDisplay;
    // 头像
    var avatarText = document.getElementById('avatar-text');
    var avatarImg = document.getElementById('avatar-img');
    if (avatarUrl && avatarUrl.length > 5) {
      avatarText.style.display = 'none';
      avatarImg.src = avatarUrl;
      avatarImg.style.display = 'block';
      avatarImg.onerror = function(){
        avatarImg.style.display = 'none';
        avatarText.style.display = 'block';
      };
    } else {
      avatarText.style.display = 'block';
      avatarImg.style.display = 'none';
    }
  }

  // ⭐ 渲染未登录 UI
  function renderLoggedOut() {
    document.getElementById('panel-logged-out').classList.remove('hidden');
    document.getElementById('panel-logged-in').classList.add('hidden');
  }

  // ⭐ 刷新按钮动画
  var refreshBtn = document.getElementById('btn-refreshRepos');
  var statusDot = document.getElementById('status-dot');
  var statusText = document.getElementById('status-text');
  var statusLabel = document.getElementById('status-label');
  var refreshTimeout = null;

  function startRefresh() {
    if (refreshBtn) {
      refreshBtn.classList.add('spinning');
      refreshBtn.style.pointerEvents = 'none';
    }
    if (statusDot) { statusDot.className = 'status-dot loading'; }
    if (statusText) { statusText.textContent = '正在刷新仓库状态...'; }
    if (statusLabel) { statusLabel.textContent = '刷新中'; }
  }

  function endRefresh(ok, msg) {
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
      refreshBtn.style.pointerEvents = 'auto';
    }
    if (statusDot) { statusDot.className = ok ? 'status-dot ok' : 'status-dot off'; }
    if (statusText) { statusText.textContent = msg || ''; }
    if (statusLabel) { statusLabel.textContent = ok ? '就绪' : '错误'; }
  }

  // ⭐ 接收来自扩展的消息
  window.addEventListener('message', function(e){
    var d = e.data;
    if (d.loggedIn !== undefined) {
      if (d.loggedIn) {
        renderLoggedIn(d.loginName, d.avatarUrl);
      } else {
        renderLoggedOut();
      }
    }
    if (d.repoName) {
      document.getElementById('repo-name').textContent = d.repoName;
    }
    if (d.buildCmd !== undefined) {
      document.getElementById('build-cmd').textContent = d.buildCmd || '未配置';
    }
    if (d.status !== undefined) {
      if (statusText) statusText.textContent = d.statusText || d.status;
      if (statusLabel) statusLabel.textContent = d.status;
      if (statusDot) statusDot.className = (d.status.indexOf('失败')>=0 || d.status.indexOf('错误')>=0) ? 'status-dot off' : 'status-dot ok';
    }
    // ⭐ 刷新状态消息
    if (d.refreshState === 'start') {
      startRefresh();
    } else if (d.refreshState === 'done') {
      endRefresh(true, d.statusText || '刷新完成');
    } else if (d.refreshState === 'error') {
      endRefresh(false, d.statusText || '报错！请检查网络是否正常');
    }
    // ⭐ 头像更新
    if (d.avatarUrl !== undefined && d.avatarUrl && d.avatarUrl.length > 5) {
      var at = document.getElementById('avatar-text');
      var ai = document.getElementById('avatar-img');
      if (at) at.style.display = 'none';
      if (ai) { ai.src = d.avatarUrl; ai.style.display = 'block'; ai.onerror = function(){ ai.style.display='none'; if(at) at.style.display='block'; }; }
    }
  });

  // ⭐ 请求当前状态
  send('getState');
})();
</script>
</body></html>`;
  }
}
