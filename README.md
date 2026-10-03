# Jiao_Reader

[简体中文](README.md) | [English](README.en.md) | [Català](README.ca.md) | [Español](README.es.md)

项目地址：[chouchongYHMing/Jiao_Reader](https://github.com/chouchongYHMing/Jiao_Reader) · 安装包下载：[Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases)

面向 Windows 10 / 11 x64 的本地论文 PDF 阅读器。使用 PDF.js 阅读论文，通过本机 Ollama 中已经安装的模型翻译选中的文字。

个人阅读工具，当前版本 `0.3.0`。空白页采用高松灯书桌阅读同人插画；打开论文后，划选文字即可在选区附近的气泡中查看译文，右侧保留完整原文与译文。

应用界面目前为简体中文，默认将选文翻译为简体中文。四种语言的 README 用于介绍项目与使用方法。

## 给使用者：安装后即可阅读

1. 在 [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases) 页面下载 `Jiao_Reader-Setup-0.3.0.exe`，运行并完成安装。`Source code` 是源码压缩包；普通使用者下载 Setup 即可。
2. 从桌面或开始菜单打开 Jiao_Reader，打开或拖入 PDF。
3. 使用滚轮连续阅读；顶部显示当前页和总页数，可输入页码跳转，或使用 `+`、`−` 和“适合宽度”调整页面。

安装包内已包含桌面运行环境，同学无需安装 Node.js、Python 或开发工具。默认仅安装到当前 Windows 用户，安装目录可改为自己有写权限的目录；开始菜单、桌面快捷方式和 Windows“已安装的应用”卸载入口由安装程序创建。默认目录不需要管理员权限。

**当前发行包尚未进行代码签名。** Windows SmartScreen 或浏览器可能提示“未知发布者”或“Windows 已保护你的电脑”。这与缺少 Node.js、Python 无关。接收者应先核对文件来源；签名证书和信誉建立属于后续正式发布工作，不应要求关闭系统防护。

完整首次使用步骤见 [快速上手](docs/QUICKSTART.zh-CN.md)。

## 准备本地翻译

阅读 PDF 不依赖 Ollama。需要翻译时：

1. 安装并启动 [Ollama Windows 版](https://ollama.com/download/windows)。
2. 在 PowerShell 中用 Ollama 下载你准备使用的模型，例如原项目使用的模型：

   ```powershell
   ollama pull qwen3:4b-instruct
   ollama list
   ```

3. 返回 Jiao_Reader，刷新本地模型状态，在模型面板选择已经安装的模型。
4. 在论文中划选一段文字，选区附近的气泡显示翻译进度和译文，右侧同步保留原文与译文。

应用启动时会检测本机 Ollama 是否可用，并显示连接、安装及本地模型状态。检测到已安装但服务未运行时，可点击“启动 Ollama”；也可以打开 Ollama 或在终端执行 `ollama serve`。模型下载完毕后刷新列表即可使用。应用会记住所选模型；模型已被移除时，需要重新选择。

**模型面板仅选择 Ollama 已有的本地模型。** 它不下载模型，不接受任意模型名，也不是把 GGUF 文件直接拖入程序的导入器。新模型仍通过 `ollama pull` 或 Ollama 自身的导入命令准备。安装程序不捆绑 Ollama 或模型，也不会自动安装它们。

模型占用的磁盘、内存和显存取决于所选模型。首次翻译可能需要等待 Ollama 将模型载入内存。更换模型后，翻译速度和质量也会变化。Ollama 的模型准备方式见[官方文档](https://docs.ollama.com/quickstart)。

## 阅读与翻译

| 操作 | 方法 |
| --- | --- |
| 打开论文 | “打开 PDF”、拖入文件或 `Ctrl+O` |
| 连续阅读 | 鼠标滚轮或右侧滚动条 |
| 确认阅读位置 | 顶部页码与底部“第 X 页 / 共 N 页”，随滚动更新 |
| 跳转页面 | 顶部输入页码并确认 |
| 缩放 | `+`、`−`、“适合宽度”，或 `Ctrl++` / `Ctrl+-` |
| 翻译 | 在 PDF 文字层选中一段内容，在选区附近的气泡查看译文 |
| 复制译文 | 气泡或右侧译文卡片中的复制按钮 |
| 更换模型 | 刷新模型列表，选择本机已安装的模型 |

PDF 文件在本机读取；划选文字发送到本机 `127.0.0.1:11434`。目前支持带有可提取文字层的 PDF；扫描件需要先做 OCR。单个 PDF 最大 200 MB，单次翻译最多 3000 字。翻译记录仅保存在本次程序运行期间。

## 开发与打包

以下命令仅供维护项目的人使用，同学安装发行版不需要执行。需要 Windows x64 和 Node.js 22.12 或更新版本。首次安装构建依赖、下载 Electron 与 NSIS 工具需要联网。

```powershell
git clone https://github.com/chouchongYHMing/Jiao_Reader.git
cd Jiao_Reader
npm ci
npm run check
npm start
```

生成可分发安装程序：

```powershell
npm run build:win
```

输出：`release\Jiao_Reader-Setup-0.3.0.exe`。把这一个安装文件发给同学即可；无需发送 `node_modules`、源码、应用构建目录或自己的 Ollama 模型文件。

仅生成待验证的应用目录 `dist\Jiao_Reader-win32-x64`：

```powershell
npm run build:win:dir
```

保留原来的便携版打包方式：

```powershell
npm run package:win
```

便携版入口为 `dist\Jiao_Reader-win32-x64\Jiao_Reader.exe`。发送便携版时必须压缩整个 `Jiao_Reader-win32-x64` 目录，单独复制内部 `.exe` 无法运行。安装版和便携版都不包含 Ollama 或模型。

安装配置见 `electron-builder.yml`。`appId: com.jiao.reader` 应保持稳定，以便后续安装包识别同一应用。每用户安装通过 `build-resources/installer.nsh` 限定，默认卸载流程由 electron-builder 提供。构建入口先通过 `package-portable.cjs` 的文件白名单生成应用，再使用 electron-builder 的 `prepackaged` 选项封装 NSIS 安装包；两个发行格式使用相同的程序。运行代码、PDF.js 资源和许可证随包分发，README 与使用文档也放在程序目录中。

发布前验证步骤见 [Windows 发行验证](docs/RELEASE_CHECKLIST.md)。

## 发布到 GitHub

源码提交到 GitHub 仓库；Setup 安装包和 `SHA256SUMS.txt` 上传为 **Release 附件**。同学从 Releases 下载 Setup 即可，模型仍通过 Ollama 准备。完整建仓、推送和发布步骤见 [GitHub 发布指南](docs/GITHUB_RELEASE.zh-CN.md)。

## 项目结构

```text
main.cjs                      Electron 主进程、窗口、PDF 文件操作与桌面接口
ollama.cjs                    Ollama 检测、模型列表与本地翻译
preload.cjs                   限定页面可调用的桌面接口
app/                          阅读界面、PDF 渲染与交互模块
app/pdfjs/                    PDF.js、字符映射与字体资源
electron-builder.yml          Windows NSIS 安装包配置
build-resources/              Windows 图标、安装模式与便携版打包脚本
docs/                         首次使用和发行验证说明
```

## 与 Jiao_Translator 的关系

Jiao_Reader 参考 Jiao_Translator 的 PDF.js 阅读器和本地翻译提示词，桌面版直接调用 Ollama 的本机接口。PDF.js 许可证位于 `app/pdfjs/LICENSE`，字体许可证随 `app/pdfjs/standard_fonts/` 分发。原始项目见 [Jiao_Translator](https://github.com/chouchongYHMing/Jiao_Translator)。
