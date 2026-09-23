// GitPilot Sidebar — WebView Provider (supports login state persistence)
// ============================================================
import * as vscode from 'vscode';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _isLoggedIn = false;
  private _loginName = '';
  private _repoName = '';
  private _buildCmd = '';
  private _status = 'Not signed in';
  private _statusText = 'Refresh to sync repository, deploy and build status';

  private _avatarUrl = '';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true, // ⭐ Keep the webview alive when switching tabs
    };
    webviewView.webview.html = this.getHtml();

    // Send the current state as soon as the webview is ready
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
          // ⭐ The webview requests the current state → restore it immediately
          this._pushState();
          break;
      }
    });

    // ⭐ If logged in, restore the state immediately (handles webview rebuilds)
    if (this._isLoggedIn) {
      this._pushState();
    }
  }

  refresh(): void {
    if (this._view) {
      this._view.webview.html = this.getHtml();
      // ⭐ Restore the state immediately after rebuilding the HTML
      if (this._isLoggedIn) {
        // Wait for the webview to finish loading before sending the message
        setTimeout(() => this._pushState(), 100);
      }
    }
  }

  /** ⭐ Push the full current state to the webview */
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

  /** ⭐ Set the logged-in state */
  setLoggedIn(login: string, avatarUrl?: string): void {
    this._isLoggedIn = true;
    this._loginName = login;
    this._avatarUrl = avatarUrl ?? '';
    this._status = '✅ Ready';
    this._statusText = 'Refresh to sync repository, deploy and build status';
    this._pushState();
  }

  /** ⭐ Set the logged-out state */
  setLoggedOut(): void {
    this._isLoggedIn = false;
    this._loginName = '';
    this._repoName = '';
    this._buildCmd = '';
    this._status = 'Not signed in';
    this._statusText = 'Please sign in to your GitHub account first';
    this._pushState();
  }

  /** ⭐ Update the repository name */
  setRepoName(name: string): void {
    this._repoName = name;
    this._pushState();
  }

  /** ⭐ Update the build command */
  setBuildCmd(cmd: string): void {
    this._buildCmd = cmd;
    this._pushState();
  }

  /** ⭐ Update the status text */
  setStatus(status: string, statusText?: string): void {
    this._status = status;
    if (statusText !== undefined) this._statusText = statusText;
    this._pushState();
  }

  // ---- Legacy API compatibility (postMessage still works from the outside) ----
  postMessage(msg: any): void {
    // Update the internal state
    if (msg.loggedIn !== undefined) {
      this._isLoggedIn = msg.loggedIn;
      if (msg.loggedIn) {
        this._status = msg.status ?? '✅ Ready';
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
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${vscode.Uri.parse('').scheme}: https: data:; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
  :root{
    --bg:#e8f4fd;
    --fg:#1a1a2e;
    --btn:#0366d6;
    --btn-fg:#fff;
    --btn-hover:#0256b9;
    --input-bg:#ffffff;
    --input-border:#c8dff5;
    --desc:#5a7a9a;
    --accent:#0366d6;
    --green:#22863a;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--vscode-font-family);font-size:13px;color:var(--fg);padding:0;background:var(--bg)}

  /* ── Account card ── */
  .account-card{
    display:flex;align-items:center;gap:10px;
    padding:12px 14px;margin:10px;border-radius:8px;
    background:linear-gradient(135deg,#d6eaf8 0%,#bddaf0 100%);
    border:1px solid #b0cfe8;
  }
  .avatar{
    width:40px;height:40px;border-radius:50%;background:#c8dff5;
    display:flex;align-items:center;justify-content:center;
    font-size:18px;flex-shrink:0;overflow:hidden;
    border:2px solid #fff;
  }
  .avatar img{width:40px;height:40px;border-radius:50%;display:block}
  .account-info{flex:1;min-width:0}
  .account-name{font-size:14px;font-weight:700;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .account-desc{font-size:11px;color:#5a7a9a;margin-top:1px}
  .btn-logout{
    padding:4px 10px;border-radius:4px;border:1px solid #f8514933;
    background:transparent;color:#d73a49;font-size:11px;cursor:pointer;font-family:inherit;
    flex-shrink:0;
  }
  .btn-logout:hover{background:#f8514915}

  /* ── Repository selector ── */
  .repo-card{
    margin:0 10px 10px;padding:8px 12px;border-radius:6px;
    background:var(--input-bg);border:1px solid var(--input-border);
    box-shadow:0 1px 3px rgba(0,0,0,.04);
  }
  .repo-row{display:flex;align-items:center;justify-content:space-between}
  .repo-label{font-size:10px;font-weight:600;color:var(--desc);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
  .repo-name{font-size:13px;font-weight:600;color:var(--accent)}
  .repo-badge{font-size:10px;padding:2px 6px;border-radius:10px;background:#e8f4fd;color:#5a7a9a;margin-left:6px}

  /* ── Action buttons ── */
  .action-area{margin:0 10px 10px}
  .action-row{display:flex;gap:8px}
  .btn-deploy{
    flex:1;padding:10px;border:none;border-radius:6px;
    font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;
    background:linear-gradient(135deg,#22863a,#2ea043);color:#fff;
    box-shadow:0 2px 6px rgba(34,134,58,.25);
    transition:opacity .15s;
  }
  .btn-deploy:hover{opacity:.9}
  .btn-sync{
    padding:10px 16px;border:none;border-radius:6px;
    font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;
    background:#fff;color:var(--accent);
    border:1px solid var(--input-border);
    box-shadow:0 1px 3px rgba(0,0,0,.04);
  }
  .btn-sync:hover{background:#f0f7ff}

  /* ── Build command area ── */
  .build-card{
    margin:0 10px 10px;padding:8px 12px;border-radius:6px;
    background:var(--input-bg);border:1px solid var(--input-border);
    box-shadow:0 1px 3px rgba(0,0,0,.04);
  }
  .build-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
  .build-label{font-size:10px;font-weight:600;color:var(--desc);text-transform:uppercase;letter-spacing:0.5px}
  .build-cmd{font-size:12px;color:#5a7a9a;font-family:var(--vscode-editor-font-family);word-break:break-all}

  /* ── Repository management ── */
  .mgmt-area{margin:0 10px 10px}
  .mgmt-row{display:flex;gap:6px}
  .btn-mgmt{
    flex:1;padding:6px 8px;border-radius:4px;border:1px solid var(--input-border);
    background:#fff;color:var(--fg);font-size:11px;font-family:inherit;cursor:pointer;
    text-align:center;
  }
  .btn-mgmt:hover{background:#f0f7ff}

  /* ── Status bar ── */
  .status-bar{
    margin:0 10px 10px;padding:6px 10px;border-radius:4px;
    background:#d6eaf8;border:1px solid #b0cfe8;
    display:flex;align-items:center;gap:6px;font-size:11px;
  }
  .status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .status-dot.ok{background:var(--green)}
  .status-dot.off{background:#d73a49}
  .status-dot.loading{background:#d29922;animation:pulse 1s infinite}
  .status-text{color:#5a7a9a}

  /* ── Divider ── */
  .divider{height:1px;background:var(--input-border);margin:8px 10px}

  /* ── Login button ── */
  .login-area{padding:10px}
  .btn-login-full{
    display:flex;align-items:center;justify-content:center;gap:8px;
    width:calc(100% - 20px);margin:10px;padding:12px;border:none;border-radius:8px;
    font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;
    background:linear-gradient(135deg,#22863a,#2ea043);color:#fff;
    box-shadow:0 2px 6px rgba(34,134,58,.25);
  }
  .btn-login-full:hover{opacity:.9}
  .github-icon{width:20px;height:20px}

  .btn-icon{
    padding:2px 6px;border-radius:3px;border:1px solid var(--input-border);
    background:#fff;color:var(--desc);font-size:10px;cursor:pointer;font-family:inherit;
    transition:transform .3s;
  }
  .btn-icon:hover{color:var(--fg);background:#f0f7ff}
  .btn-icon.spinning{animation:spin 1s linear infinite;color:var(--accent);pointer-events:none}

  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

  .hidden{display:none !important}
</style></head>
<body>

<!-- ════ Logged-out state ════ -->
<div id="panel-logged-out">
  <div class="login-area">
    <button class="btn-login-full" id="btn-login">
      <svg class="github-icon" viewBox="0 0 16 16" fill="white"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Login with GitHub
    </button>
  </div>
</div>

<!-- ════ Logged-in state ════ -->
<div id="panel-logged-in" class="hidden">

  <!-- Account card -->
  <div class="account-card">
    <div class="avatar" id="avatar-area">
      <span id="avatar-text" style="font-size:18px">🐱</span>
      <img id="avatar-img" src="" style="display:none" alt="">
    </div>
    <div class="account-info">
      <div class="account-name" id="account-name">GitHub</div>
      <div class="account-desc">GitHub account nickname</div>
    </div>
    <button class="btn-logout" id="btn-logout">Sign out</button>
  </div>

  <!-- Repository selector -->
  <div class="repo-card">
    <div class="repo-label">📦 Current repository</div>
    <div class="repo-row">
      <div>
        <span class="repo-name" id="repo-name">--</span>
        <span class="repo-badge" id="repo-badge" style="display:none">Public</span>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn-icon" id="btn-switchRepo" title="Switch repository">🔄</button>
        <button class="btn-icon" id="btn-refreshRepos" title="Refresh status">🔃</button>
      </div>
    </div>
  </div>

  <!-- Action buttons -->
  <div class="action-area">
    <div class="action-row">
      <button class="btn-deploy" id="btn-deploy">🚀 Deploy</button>
      <button class="btn-sync" id="btn-sync">🔄 Sync</button>
    </div>
  </div>

  <!-- Build command -->
  <div class="build-card">
    <div class="build-header">
      <span class="build-label">🔨 Build command</span>
      <button class="btn-icon" id="btn-configureBuild" title="Configure build command">⚙️</button>
    </div>
    <div class="build-cmd" id="build-cmd">Not configured</div>
  </div>

  <div class="divider"></div>

  <!-- Repository management -->
  <div class="mgmt-area">
    <div class="mgmt-row">
      <button class="btn-mgmt" id="btn-createRepo">+ Create repository</button>
    </div>
  </div>

  <div class="divider"></div>

  <!-- Status bar -->
  <div class="status-bar">
    <span class="status-dot ok" id="status-dot"></span>
    <span class="status-text" id="status-text">Refresh to sync repository, deploy and build status</span>
    <span style="margin-left:auto;color:var(--green);font-weight:600" id="status-label">Ready</span>
  </div>
</div>

<script>
(function(){
  var vscode = acquireVsCodeApi();
  function send(cmd){ vscode.postMessage({command:cmd}); }

  // Bind buttons
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

  // ⭐ Render the logged-in UI
  function renderLoggedIn(loginName, avatarUrl) {
    document.getElementById('panel-logged-out').classList.add('hidden');
    document.getElementById('panel-logged-in').classList.remove('hidden');
    var nameDisplay = loginName || 'GitHub';
    document.getElementById('account-name').textContent = nameDisplay;
    // Avatar
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

  // ⭐ Render the logged-out UI
  function renderLoggedOut() {
    document.getElementById('panel-logged-out').classList.remove('hidden');
    document.getElementById('panel-logged-in').classList.add('hidden');
  }

  // ⭐ Refresh button animation
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
    if (statusText) { statusText.textContent = 'Refreshing repository status...'; }
    if (statusLabel) { statusLabel.textContent = 'Refreshing'; }
  }

  function endRefresh(ok, msg) {
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
      refreshBtn.style.pointerEvents = 'auto';
    }
    if (statusDot) { statusDot.className = ok ? 'status-dot ok' : 'status-dot off'; }
    if (statusText) { statusText.textContent = msg || ''; }
    if (statusLabel) { statusLabel.textContent = ok ? 'Ready' : 'Error'; }
  }

  // ⭐ Receive messages from the extension
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
      document.getElementById('build-cmd').textContent = d.buildCmd || 'Not configured';
    }
    if (d.status !== undefined) {
      if (statusText) statusText.textContent = d.statusText || d.status;
      if (statusLabel) statusLabel.textContent = d.status;
      if (statusDot) statusDot.className = (String(d.status).toLowerCase().indexOf('fail')>=0 || String(d.status).toLowerCase().indexOf('error')>=0) ? 'status-dot off' : 'status-dot ok';
    }
    // ⭐ Refresh state messages
    if (d.refreshState === 'start') {
      startRefresh();
    } else if (d.refreshState === 'done') {
      endRefresh(true, d.statusText || 'Refresh complete');
    } else if (d.refreshState === 'error') {
      endRefresh(false, d.statusText || 'Error! Please check your network connection');
    }
    // ⭐ Avatar update
    if (d.avatarUrl !== undefined && d.avatarUrl && d.avatarUrl.length > 5) {
      var at = document.getElementById('avatar-text');
      var ai = document.getElementById('avatar-img');
      if (at) at.style.display = 'none';
      if (ai) { ai.src = d.avatarUrl; ai.style.display = 'block'; ai.onerror = function(){ ai.style.display='none'; if(at) at.style.display='block'; }; }
    }
  });

  // ⭐ Request the current state
  send('getState');
})();
</script>
</body></html>`;
  }
}
