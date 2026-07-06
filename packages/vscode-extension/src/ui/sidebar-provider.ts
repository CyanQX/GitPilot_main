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
        case 'refreshRepos': vscode.commands.executeCommand('gitpilot.refreshRepos'); break;
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
      repoName: this._repoName,
      buildCmd: this._buildCmd,
      status: this._status,
    });
  }

  /** ⭐ 设置已登录状态 */
  setLoggedIn(login: string): void {
    this._isLoggedIn = true;
    this._loginName = login;
    this._status = '✅ 就绪';
    this._pushState();
  }

  /** ⭐ 设置已登出状态 */
  setLoggedOut(): void {
    this._isLoggedIn = false;
    this._loginName = '';
    this._repoName = '';
    this._buildCmd = '';
    this._status = '未登录';
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
  setStatus(status: string): void {
    this._status = status;
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
<style>
  :root{--bg:var(--vscode-sideBar-background);--fg:var(--vscode-sideBar-foreground);--btn:var(--vscode-button-background);--btn-fg:var(--vscode-button-foreground);--btn-hover:var(--vscode-button-hoverBackground);--input-bg:var(--vscode-input-background);--input-border:var(--vscode-input-border);--desc:var(--vscode-descriptionForeground)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--vscode-font-family);font-size:13px;color:var(--fg);padding:10px;background:var(--bg)}
  .section{margin-bottom:14px}
  .label{font-size:11px;font-weight:600;color:var(--desc);text-transform:uppercase;margin-bottom:4px}
  .row{display:flex;gap:6px}
  .btn{flex:1;padding:8px 12px;border:none;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;text-align:center}
  .btn-primary{background:var(--btn);color:var(--btn-fg)}
  .btn-primary:hover{background:var(--btn-hover)}
  .btn-secondary{background:var(--input-bg);color:var(--fg);border:1px solid var(--input-border)}
  .btn-secondary:hover{background:var(--btn-hover)}
  .btn-sm{padding:4px 8px;font-size:11px;border-radius:3px;border:none;cursor:pointer;background:var(--input-bg);color:var(--fg);font-family:inherit}
  .btn-sm:hover{background:var(--btn-hover)}
  .btn-full{display:block;width:100%;padding:10px;background:#2ea043;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
  .btn-full:hover{background:#3fb950}
  .info-box{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:4px;font-size:12px}
  .green{color:#4ec9b0}.yellow{color:#e2b714}.muted{color:var(--desc);font-size:11px}
  hr{border:none;border-top:1px solid var(--input-border);margin:10px 0}
</style></head>
<body>
  <div class="section">
    <div class="label">账号</div>
    <div id="login-area">
      <button class="btn-full" id="btn-login">🔐 Login with GitHub</button>
    </div>
  </div>
  <div class="section" id="repo-section" style="display:none">
    <div class="label">📦 当前仓库</div>
    <div class="info-box">
      <span id="repo-name" class="green">--</span>
      <button class="btn-sm" id="btn-switchRepo">切换</button>
    </div>
  </div>
  <div class="section" id="action-section" style="display:none">
    <div class="label">🚀 操作</div>
    <div class="row">
      <button class="btn btn-primary" id="btn-deploy">🚀 Deploy</button>
      <button class="btn btn-secondary" id="btn-sync">🔄 Sync</button>
    </div>
  </div>
  <hr id="div1" style="display:none">
  <div class="section" id="repo-mgr" style="display:none">
    <div class="label">📋 仓库管理</div>
    <div class="row">
      <button class="btn-sm" id="btn-createRepo">+ 创建仓库</button>
      <button class="btn-sm" id="btn-refreshRepos">🔄 刷新列表</button>
    </div>
  </div>
  <hr id="div2" style="display:none">
  <div class="section" id="build-section" style="display:none">
    <div class="label">🔨 构建命令 <button class="btn-sm" id="btn-configureBuild">⚙️</button></div>
    <span class="muted" id="build-cmd">未配置</span>
  </div>
  <div class="muted" style="margin-top:12px" id="status-text">状态: 未登录</div>
<script>
(function(){
  var vscode = acquireVsCodeApi();
  function send(cmd){ vscode.postMessage({command:cmd}); }

  // 绑定按钮事件（不用 onclick，因为 webview CSP 会拦截）
  function bind(id, cmd){
    var el = document.getElementById(id);
    if(el) el.addEventListener('click', function(){ send(cmd); });
  }
  bind('btn-login', 'login');
  bind('btn-deploy', 'deploy');
  bind('btn-sync', 'sync');
  bind('btn-switchRepo', 'switchRepo');
  bind('btn-createRepo', 'createRepo');
  bind('btn-refreshRepos', 'refreshRepos');
  bind('btn-configureBuild', 'configureBuild');

  // ⭐ 渲染已登录 UI
  function renderLoggedIn(loginName) {
    var nameDisplay = loginName || 'GitHub';
    document.getElementById('login-area').innerHTML =
      '<div class="info-box"><span class="green">\u2714 ' + nameDisplay + '</span>' +
      '<button class="btn-sm" id="btn-logout">\u767B\u51FA</button></div>';
    setTimeout(function(){
      var b = document.getElementById('btn-logout');
      if(b) b.addEventListener('click', function(){ send('logout'); });
    }, 50);
    var ids = ['repo-section','action-section','repo-mgr','build-section','div1','div2'];
    ids.forEach(function(id){ document.getElementById(id).style.display='block'; });
  }

  // ⭐ 渲染未登录 UI
  function renderLoggedOut() {
    document.getElementById('login-area').innerHTML =
      '<button class="btn-full" id="btn-login">\u{1F510} Login with GitHub</button>';
    setTimeout(function(){
      var b = document.getElementById('btn-login');
      if(b) b.addEventListener('click', function(){ send('login'); });
    }, 50);
    var ids = ['repo-section','action-section','repo-mgr','build-section','div1','div2'];
    ids.forEach(function(id){ document.getElementById(id).style.display='none'; });
  }

  // ⭐ 接收来自扩展的消息
  window.addEventListener('message', function(e){
    var d = e.data;
    if (d.loggedIn !== undefined) {
      if (d.loggedIn) {
        renderLoggedIn(d.loginName);
      } else {
        renderLoggedOut();
      }
    }
    if (d.repoName) document.getElementById('repo-name').textContent = d.repoName;
    if (d.buildCmd) document.getElementById('build-cmd').textContent = d.buildCmd;
    if (d.status) document.getElementById('status-text').textContent = '\u72B6\u6001: ' + d.status;
  });

  // ⭐ webview 加载完成后，请求当前状态（解决切换标签页后状态丢失）
  send('getState');
})();
</script>
</body></html>`;
  }
}
