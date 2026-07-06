# GitPilot — 已知问题修复记录

> 从 v1.0.0 到 v1.2.8，按影响程度排列。每个问题标注了 **现象 → 根因 → 修复方案 → 修复版本**。

---

## 🔴 严重问题

### 1. 部署/同步只上传了 README.md，整个项目没上传

| 项 | 内容 |
|----|------|
| **现象** | 点 Sync 或 Deploy 后 GitHub 上只有一个 `README.md`，其他所有项目文件都没上去 |
| **根因** | `stageFiles()` 逻辑顺序反了 —— 先 `git reset` 排除文件 → 再 `git add .` 又把排除的文件加回来，等于没排除。同时 `git reset` 在新仓库（无 HEAD）时静默失败 |
| **修复** | 改为 `git add -A`（全量暂存）→ 再 `git reset --` / `git rm --cached` 排除密钥和构建产物。增加 `getStagedFiles()` 验证实际暂存数量 |
| **版本** | v1.2.7 / v1.2.8 |

### 2. 部署失败：`'origin' does not appear to be a git repository`

| 项 | 内容 |
|----|------|
| **现象** | 创建了 GitHub 仓库，点 Deploy 报错「远程仓库 origin 未配置」，推送失败 |
| **根因** | `handleCreateRepo` 只在 GitHub 上创建仓库，没有执行本地 `git remote add origin` |
| **修复** | ① 创建仓库后自动 `git init` + `git remote add origin` ② 推送前检查 origin 是否存在 ③ 通知里增加「🔗 关联仓库」按钮，选已有仓库一键关联 |
| **版本** | v1.2.2 / v1.2.3 |

### 3. 部署失败：`src refspec main does not match any`

| 项 | 内容 |
|----|------|
| **现象** | 点 Deploy 报错「src refspec main does not match any」，推送失败 |
| **根因** | 代码硬编码推送 `main` 分支，但用户仓库默认分支是 `master` 或尚未创建 |
| **修复** | `push()` 内部验证分支是否存在 → 不存在则回退到 `getCurrentBranch()` → 再失败则给明确的中文提示 |
| **版本** | v1.2.0 |

---

## 🟡 体验断裂问题

### 4. 登录后切换到其他标签页，回来显示"未登录"

| 项 | 内容 |
|----|------|
| **现象** | 已登录状态，切到文件浏览器再切回来，侧边栏变回「未登录」状态，Deploy 按钮消失 |
| **根因** | VS Code 默认在切换标签时**销毁** webview，回来时重建 HTML 永远是初始的「未登录」 |
| **修复** | ① 设置 `retainContextWhenHidden: true` 保留 webview ② `SidebarProvider` 内部记忆登录状态 ③ webview 重建时发送 `getState` 请求恢复 |
| **版本** | v1.1.1 |

### 5. 点击「在 GitHub 上查看」按钮没反应

| 项 | 内容 |
|----|------|
| **现象** | 部署成功后通知里有「在 GitHub 上查看」按钮，点击无任何反应 |
| **根因** | `showDeployResult()` 成功分支没有 `await notifier.show()`，返回值被忽略 |
| **修复** | 成功分支也 `await` 返回值 → 检测 `open-repo` action → 用 Edge/Chrome 打开仓库 URL |
| **版本** | v1.2.6 |

### 6. VS Code 自带的 GitHub 登录弹窗抢在 GitPilot 前面弹出

| 项 | 内容 |
|----|------|
| **现象** | 还没操作 GitPilot，VS Code 就弹出一个「Connect to GitHub」的登录对话框 |
| **根因** | 扩展启动时 `new Octokit()` 空认证创建了 GitHub API 实例，VS Code 检测到未认证请求后自动拦截 |
| **修复** | 不在启动时创建 Octokit，等用户真正登录后才 `new Octokit({ auth: token })`。所有 API 调用前加 `ensureLoggedIn()` 守卫 |
| **版本** | v1.2.4 |

### 7. 切换仓库后侧边栏不更新

| 项 | 内容 |
|----|------|
| **现象** | 在「当前仓库」点击切换，选了新仓库后侧边栏仓库名不变，还是旧仓库 |
| **根因** | `handleSwitchRepo` 只是弹一条消息，没有实际更新 `origin` 和侧边栏状态 |
| **修复** | 切换后自动：更新 `git remote` → 重建 `orchestrator` → 刷新侧边栏仓库名 → 自动触发状态刷新 |
| **版本** | v1.2.7 |

---

## 🟢 功能增强

### 8. 登录流程：只有 PAT 输入框，没有浏览器登录

| 项 | 内容 |
|----|------|
| **原始状态** | 点击登录 → 弹出通知「正在打开登录...」→ 弹出 PAT 输入框。没有浏览器跳转 |
| **新增** | ① QuickPick 选择登录方式（浏览器 OAuth / PAT）② 浏览器选择面板（Chrome/Edge/Firefox/Brave...）③ 本地 OAuth 回调服务器 + 自动打开浏览器授权 |
| **版本** | v1.1.0 |

### 9. 刷新按钮只列仓库数量，没有实际刷新

| 项 | 内容 |
|----|------|
| **原始状态** | 点击刷新 → 弹出「找到 N 个仓库」，不拉取任何数据 |
| **新增** | ① 真实拉取 GitHub 仓库列表 + 检查 Git 本地状态 ② 3~7 秒随机延迟模拟网络 ③ 10 秒超时提示「报错！请检查网络是否正常」④ 按钮旋转动画 |
| **版本** | v1.2.1 |

### 10. GitHub 头像不显示

| 项 | 内容 |
|----|------|
| **现象** | 登录后头像位置只显示 🐱 猫图标，不显示 GitHub 真实头像 |
| **根因** | VS Code webview 默认 CSP（Content Security Policy）阻止加载 `https://avatars.githubusercontent.com` 的外部图片 |
| **修复** | HTML `<head>` 添加 `<meta http-equiv="Content-Security-Policy" content="...img-src https: data:...">` 允许加载 HTTPS 图片。头像加载失败时自动回退到占位符 |
| **版本** | v1.2.1 / v1.2.5 |

---

## 📊 版本总览

| 版本 | 修复的关键问题 |
|------|--------------|
| v1.1.0 | 浏览器 OAuth 登录 + 浏览器选择面板 |
| v1.1.1 | 切换标签页登录状态不丢失 |
| v1.2.0 | 侧边栏 UI 重做 + push 分支不匹配修复 |
| v1.2.1 | 真实刷新按钮 + GitHub 头像显示 |
| v1.2.2 | 创建仓库后自动 `git remote add` |
| v1.2.3 | 通知内一键「关联仓库」按钮 |
| v1.2.4 | 阻止 VS Code 内置登录弹窗冲突 |
| v1.2.5 | 侧边栏浅蓝配色 |
| v1.2.6 | 「在 GitHub 上查看」跳转浏览器 |
| v1.2.7 | 切换仓库自动刷新 + **修复只上传 README.md** |
| v1.2.8 | `git add -A` 全量暂存 + 部署通知显示文件数 |

---

## 🔧 当前已知限制

| 限制 | 影响 | 计划 |
|------|------|------|
| OAUTH_CLIENT_ID 是占位符 | 浏览器 OAuth 登录目前实际走的是 PAT 流程 | 需注册 GitHub OAuth App |
| 不支持 GitLab / Gitee | 只能部署到 GitHub | 架构已预留 Provider 接口 |
| Webview CSP 限制 `vscode-resource:` | 部分本地资源可能加载失败 | 后续改为 `webview.asWebviewUri()` |
