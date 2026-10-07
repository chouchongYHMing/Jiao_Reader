# Jiao_Reader 的 GitHub 发布指南

公开项目地址：[chouchongYHMing/Jiao_Reader](https://github.com/chouchongYHMing/Jiao_Reader)。安装包发布到该仓库的 [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases)。

建议同时发布源码和安装包：源码放仓库，`Setup.exe` 放 **Releases 的附件**。这样其他人可以查看和改进源码，同学也可以直接下载安装。GitHub 的 Release 支持上传编译后的程序并填写版本说明，适合分发本项目的安装包。[GitHub 官方说明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

## 1. 创建源码仓库

在 GitHub 新建仓库，名称填写 `Jiao_Reader`。希望同学直接访问下载时选 **Public**；Private 仓库需要给使用者访问权限。由于本地已有 README、LICENSE 和 `.gitignore`，新建页面不要再勾选自动生成这些文件。[官方建仓与推送步骤](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)

本地建议提交：

- `app/`、`main.cjs`、`preload.cjs`、`ollama.cjs` 等运行源码。
- `package.json`、`package-lock.json`、`electron-builder.yml`、`build-resources/` 和 `tests/`。
- `README.md`、`LICENSE`、`docs/`、`.gitignore` 及应用实际使用的插画、图标和第三方许可证。

依赖和构建结果留在本机：`node_modules/`、`dist/`、`release/`、`build/`、`backups/` 和测试输出已由 `.gitignore` 排除。自己的论文、模型权重和本机配置也不应上传；放在项目目录外最方便。首次提交前检查 `git status` 中的待提交文件。

## 2. 推送本地源码

安装 Git 后，在保存 `Jiao_Reader` 文件夹的父目录打开 PowerShell，执行以下命令。如果项目已经初始化 Git，跳过 `git init`；如果已经配置 `origin`，先用 `git remote -v` 检查地址，不要重复添加。

```powershell
cd Jiao_Reader
git init -b main
git status --short
git add .
git diff --cached --stat
git commit -m "Release Jiao_Reader 0.3.1"
git remote add origin https://github.com/chouchongYHMing/Jiao_Reader.git
git push -u origin main
```

首次提交如果要求设置 Git 身份，可按提示设置自己的提交用户名和邮箱；首次推送按 Git 的登录提示认证。

## 3. 准备可下载文件

本次已构建好的安装包位于项目的 `release/` 目录。以后更改代码后，按 [发行验证清单](RELEASE_CHECKLIST.md) 完成验证，再重新打包：

```powershell
npm ci
npm run check
npm test
npm run build:win
```

本次 Release 附件：

| 文件 | 用途 |
| --- | --- |
| `release/Jiao_Reader-Setup-0.3.1.exe` | 同学直接下载并安装 |
| `release/SHA256SUMS.txt` | 核对下载文件的 SHA-256 |
| `Jiao_Reader-Portable-0.3.1-win-x64.zip`（可选） | 不使用安装向导的便携版 |

需要便携版时先运行 `npm run package:win`，然后压缩整个 `dist/Jiao_Reader-win32-x64/` 文件夹。单独上传里面的 `Jiao_Reader.exe` 无法运行。

后续重新构建安装包时，在 PowerShell 更新校验文件：

```powershell
$setupPath = 'release/Jiao_Reader-Setup-0.3.1.exe'
$setupHash = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$setupHash  Jiao_Reader-Setup-0.3.1.exe" | Set-Content -LiteralPath 'release/SHA256SUMS.txt' -Encoding ascii
```

该命令只写安装包的校验值；若另附便携版，可将它的校验值补充到同一文件。

## 4. 创建 GitHub Release

1. 确认上传的源码与刚构建的安装包一致，在仓库主页打开 **Releases → Draft a new release**。
2. 新建标签 `v0.3.1`，Target 选择刚推送的 `main`。
3. 标题填写 `Jiao_Reader 0.3.1`，填写下面的版本说明。
4. 在附件区域上传 Setup 和 `SHA256SUMS.txt`；便携版 ZIP 可选。
5. 等待附件上传完成，再点击 **Publish release**。

这些是 GitHub 官方提供的网页发布操作；也可以先 **Save draft**，检查下载文件和说明后再发布。[管理 Release 的官方步骤](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository?tool=webui)

可直接使用的版本说明：

```markdown
## Jiao_Reader 0.3.1

- 新增最近阅读的单条删除和清空功能，只移除列表记录，不删除原始 PDF。
- 优化正文拖选，减少在行间空白和页边距误选大量文字或跳到页尾的问题。
- 改进双栏正文选取；复杂版式请核对选中的原文，建议一次选择同一栏的一段。
- 保留划选翻译气泡，右侧同步显示原文与译文。
- 保留高松灯书桌阅读同人插画。
- 支持连续滚动、页码显示与跳转、缩放及适合宽度。
- 检测本机 Ollama，选择已经安装的本地模型。

### 安装

Windows 10 / 11 x64：下载下方 Assets 中的 Jiao_Reader-Setup-0.3.1.exe。
安装包包含运行环境，不需要 Node.js 或 Python。
Source code 是源码压缩包，普通使用者无需下载。

### 翻译准备

先安装并启动 Ollama，用 ollama pull qwen3:4b-instruct 准备模型，
然后在阅读器中刷新并选择本地模型。
安装包不包含 Ollama 或模型；只阅读 PDF 无需准备模型。

当前安装包尚未签名，Windows 可能显示未知发布者。
```

GitHub 会自动为标签生成源码 ZIP 和 tar.gz；它们和手动上传的安装包用途不同。[源码附件说明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

## 5. 把下载入口发给同学

发布后可以分享最新正式版的固定地址：

```text
https://github.com/chouchongYHMing/Jiao_Reader/releases/latest
```

GitHub 会将这个地址指向最新 Release；日后更新版本，通常可以继续使用同一个下载入口。[官方链接格式](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)

后续发版时同步修改 `package.json`、`package-lock.json` 和文档中的版本号，构建新的安装包，再以新标签发布。已经发出的版本保留，方便使用者按版本反馈问题。
