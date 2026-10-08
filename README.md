# Jiao_Reader

[简体中文](README.md) | [English](README.en.md) | [Català](README.ca.md) | [Español](README.es.md)

项目地址：[chouchongYHMing/Jiao_Reader](https://github.com/chouchongYHMing/Jiao_Reader) · 安装包下载：[Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases)

面向 Windows 10 / 11 x64 的本地论文 PDF 阅读器。使用 PDF.js 阅读论文，通过本机 Ollama 中已经安装的模型翻译选中的文字。

个人阅读工具，当前版本 `0.3.4`。打开论文后，划选文字即可在选区附近的气泡中查看译文，右侧保留完整原文与译文。

应用界面目前为简体中文，默认将选文翻译为简体中文。四种语言的 README 用于介绍项目与使用方法。

## 给使用者：安装后即可阅读

1. 在 [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases) 页面下载 `Jiao_Reader-Setup-0.3.4.exe`，运行并完成安装。`Source code` 是源码压缩包；普通使用者下载 Setup 即可。
2. 从桌面或开始菜单打开 Jiao_Reader，打开或拖入 PDF。
3. 使用滚轮连续阅读；顶部显示当前页和总页数，可输入页码跳转，或使用 `+`、`−` 和“适合宽度”调整页面。

本次 `0.3.4` 发行包沿用 `0.3.1` 的 Electron 启动程序，因此 Windows 的 `.exe` 文件属性可能仍显示 `0.3.1`；应用和安装包版本为 `0.3.4`。

安装包内已包含桌面运行环境，同学无需安装 Node.js、Python 或开发工具。默认仅安装到当前 Windows 用户，安装目录可改为自己有写权限的目录；开始菜单、桌面快捷方式和 Windows“已安装的应用”卸载入口由安装程序创建。默认目录不需要管理员权限。

**当前发行包尚未进行代码签名。** Windows SmartScreen 或浏览器可能提示“未知发布者”或“Windows 已保护你的电脑”。这与缺少 Node.js、Python 无关。接收者应先核对文件来源；签名证书和信誉建立属于后续正式发布工作，不应要求关闭系统防护。

完整首次使用步骤见 [快速上手](docs/QUICKSTART.zh-CN.md)。

**从旧版升级：** 关闭 Jiao_Reader，运行新版 Setup 并保持原安装目录即可覆盖升级，无需先卸载。最近阅读、优先级、已保存笔记和模型选择保留；Ollama 与原始 PDF 不受影响。软件没有自动更新功能。便携版需要替换完整应用目录，Setup 不会更新另一个位置的便携版。

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
| 管理最近阅读 | 用条目旁的删除按钮移除一条记录，或用“清空”移除全部记录；不会删除原始 PDF |
| 调整阅读优先级 | 右键最近阅读条目，选择“优先级 +1”或“优先级清零”；条目角标显示优先级 |
| 添加标签或笔记 | 划选正文后，右键右下方“本次阅读”中的选文记录，选择“添加标签”或“写评论 / 笔记” |
| 查看已保存标注 | 点击顶部文献标题右侧、页码左侧的“标签与笔记”，可跳页、编辑或删除笔记 |

拖选已改进行间空白、页边距和双栏正文的处理，减少选区突然扩展或跳到页尾。识别为双栏的正文会将一次拖选限制在起始栏；另一栏请重新划选。遇到复杂版式，请先检查右侧原文是否与预期一致。删除或清空最近阅读仅移除列表记录，不会删除磁盘上的 PDF，也不会关闭正在阅读的文献。

最近阅读按**优先级从高到低，再按最近阅读时间从新到旧**排列。右键菜单只有“优先级 +1”和“优先级清零”两种操作，优先级随记录保存在本机。

标签和评论 / 笔记 / 注释不需要 Ollama。每次划选都会在“本次阅读”留下包含选文和页码的记录，即使尚未翻译，也可以右键添加标注。标签用逗号分隔；同一选文的标签和笔记可一起编辑。顶部列表按最近更新时间排列，并保留原文引用与对应页码。

标签提供六种柔和的荧光笔颜色：麦穗黄、鼠尾草绿、雾蓝、淡紫、杏橙和柔珊瑚。编辑时可为每个标签选色；保存后，标签和对应 PDF 选文同时显示标记。多标签选文使用第一个标签的颜色；只有评论时也可选择标记颜色。同一篇文献的同名标签颜色一致，改色会同步相关选文。

点击列表顶部的标签可汇总查看相关选文与笔记；每段评论独立保留，按最近修改时间排列，不会互相覆盖。选择“全部”返回完整列表。新标注保存页面位置，缩放或重启后仍能恢复高亮；旧版标注仅在原文能被唯一匹配时补显高亮。标记仅保存在阅读器中，不写入 PDF。

已保存的标注独立保存在本机，重启后仍可查看；内容完全相同的 PDF 即使复制或重命名，也会关联同一组标注。标注不会写入或改动 PDF。本次阅读中的选文与翻译历史仅为**当前打开文献的暂存记录**，切换文献或重启会清空；已保存的标签和笔记不受影响。

PDF 文件在本机读取；需要翻译时，划选文字发送到本机 `127.0.0.1:11434`。目前支持带有可提取文字层的 PDF；扫描件需要先做 OCR。单个 PDF 最大 200 MB，单次翻译最多 3000 字；单条标注可引用最多 12000 字原文、包含最多 20 个标签（每个最多 50 字）和 6000 字笔记。

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

输出：`release\Jiao_Reader-Setup-0.3.4.exe`。把这一个安装文件发给同学即可；无需发送 `node_modules`、源码、应用构建目录或自己的 Ollama 模型文件。

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
reading-store.cjs             最近阅读、优先级与按文献内容关联的本地标注存储
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
