# GitPilot v2.0 — 架构重构版

> 🚀 写代码 → 点部署 → GitHub 上就有了。全程不离开 IDE。

---

## 🏗️ 架构设计（v2.0 重构后）

```
GitPilot/
├── packages/
│   │
│   ├── core/                           # 🔷 纯接口层（零平台依赖）
│   │   ├── interfaces/                 #   8 个抽象接口
│   │   ├── models/                     #   纯数据类型
│   │   ├── deploy/                     #   部署编排器（依赖接口）
│   │   ├── security/                   #   密钥检测 + Token 管理 + 过滤
│   │   │   └── patterns.yml            #   ⭐ 规则外部化，更新不改代码
│   │   └── utils/                      #   日志
│   │
│   ├── provider-github/                # 🟢 GitHub Provider
│   │   ├── GitHubRepositoryProvider    #   → IRepositoryProvider
│   │   ├── GitHubAuthProvider          #   → IAuthProvider
│   │   └── GitHubReleaseProvider       #   → IReleaseProvider
│   │
│   ├── vscode-extension/               # 🔵 VS Code 扩展
│   │   ├── extension.ts                #   组装 Provider → Orchestrator
│   │   └── providers/                  #   平台特定实现 (simple-git 等)
│   │
│   └── jetbrains-plugin/               # 🟣 JetBrains 插件 (Kotlin)
│       └── src/main/kotlin/com/gitpilot/
│           ├── core/                   #   Kotlin 版接口 + Provider + Orchestrator
│           ├── ui/                     #   工具窗口 UI
│           └── actions/                #   Deploy / Sync / Login 动作
│
├── docs/                               # 设计文档
└── scripts/                            # 开发脚本
```

---

## 🎯 核心设计原则

### 1. Core 不依赖任何平台

```
❌ 旧架构：core/github/api.ts  ← Core 直接包含 GitHub API
✅ 新架构：core/interfaces/    ← Core 只定义接口
           provider-github/    ← GitHub 是实现
```

**以后加 GitLab：只需新增 `provider-gitlab/`，Core 一行不改。**

### 2. Provider 模式 — 全部分离

| 接口 | GitHub 实现 | VS Code 平台实现 | JetBrains 平台实现 |
|------|------------|-----------------|-------------------|
| `IRepositoryProvider` | `GitHubRepositoryProvider` (Octokit) | - | `GitHubRepoProvider` (OkHttp) |
| `IAuthProvider` | `GitHubAuthProvider` (OAuth) | - | - |
| `IReleaseProvider` | `GitHubReleaseProvider` (Octokit) | - | - |
| `IGitProvider` | - | `VSCodeGitProvider` (simple-git) | `IntelliJGitProvider` (Git4Idea) |
| `IBuildProvider` | - | `VSCodeBuildProvider` | 内联实现 |
| `ISecretStorage` | - | `VSCodeSecretStorage` | `PasswordSafe` |
| `INotificationProvider` | - | `VSCodeNotificationProvider` | 内联实现 |

### 3. Build 不再猜测语言

```
❌ 旧：11 种语言自动检测 → 维护爆炸
✅ 新：用户自己写命令 → npm run build / cargo build / RunUAT BuildPlugin
```

### 4. 密钥规则外部化

```
❌ 旧：30+ 种模式硬编码在 TS 中
✅ 新：packages/core/src/security/patterns.yml → 更新规则不改代码
```

---

## 🚀 快速开始

### VS Code 扩展

```bash
cd packages/vscode-extension
npm install
npm run compile
# F5 启动调试
```

### JetBrains 插件

```bash
cd packages/jetbrains-plugin
./gradlew buildPlugin
```

---

## 📋 扩展路线（基于新架构）

| 新增内容 | 改动范围 | 改动量 |
|----------|---------|--------|
| **GitLab 支持** | 新增 `packages/provider-gitlab/` | ~200 行 |
| **Gitee 支持** | 新增 `packages/provider-gitee/` | ~150 行 |
| **Azure DevOps** | 新增 `packages/provider-azure/` | ~200 行 |
| **Cursor IDE** | 新增 `packages/cursor-extension/` | 复用 VS Code 大部分代码 |
| **新的密钥规则** | 编辑 `patterns.yml` | 0 行代码 |

---

## 📊 架构评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 分层设计 | ⭐⭐⭐⭐⭐ | Core / Provider / Platform 三层清晰 |
| 接口抽象 | ⭐⭐⭐⭐⭐ | 8 个接口覆盖所有扩展点 |
| 平台独立性 | ⭐⭐⭐⭐⭐ | Core 零平台依赖 |
| 可扩展性 | ⭐⭐⭐⭐⭐ | 新平台 = 新 Provider，不改 Core |
| 可维护性 | ⭐⭐⭐⭐⭐ | 规则外部化、Build 不猜测 |
