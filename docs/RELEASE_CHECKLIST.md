# Windows 发行验证

本页是发布前检查步骤，不表示每次构建已经完成全部验证。保留实际构建版本和检查结果，再分发安装包。

## 构建与内容

1. 在 Windows x64 上执行 `npm ci`、`npm run check`、`npm test`、`npm run test:reader`、`npm run test:selection`、`npm run test:recent` 和 `npm run build:win`。
2. 确认 `release/Jiao_Reader-Setup-0.3.2.exe` 存在且版本为 0.3.2。
3. 检查 `dist/Jiao_Reader-win32-x64/resources/app.asar` 包含 `main.cjs`、`preload.cjs`、`ollama.cjs`、完整 `app/` 阅读模块、PDF.js worker、字体和 cmap 资源。安装包直接封装此应用目录；安装后的可执行文件及 app.asar 应与此目录的文件具有相同 SHA-256。
4. 确认包内没有 `node_modules` 开发依赖、测试、验证输出或维护者本地论文。保留应用目录中 Electron / Chromium 的许可证、`LICENSE.jiao-reader.txt`，以及 `app/pdfjs/` 内的许可证。
5. `npm run package:win` 应仍生成 `dist/Jiao_Reader-win32-x64/Jiao_Reader.exe`，并可打开 PDF。
6. 确认 `README.md`、`README.en.md`、`README.ca.md`、`README.es.md` 均包含在应用目录及内部归档中，语言切换链接可相互访问，公开地址统一指向本项目仓库。

## 安装与卸载

没有现存安装或运行中的 Jiao_Reader 时，可以执行 `./tests/install-smoke.ps1 -ValidateReader`，在项目的临时目录中安装、启动并运行阅读器测试，最后卸载。脚本检测到已有安装、快捷方式或运行进程时会停止；不会覆盖日常安装。

在 Windows Sandbox 或干净的 Windows 10 / 11 x64 虚拟机中验证，优先使用标准用户账户：

- 系统没有 Node.js 或 Python 时，安装后仍可启动并阅读 PDF。
- 使用默认目录时不弹管理员提权；能选择有写权限的自定义目录，含空格和中文的路径也正常。
- 仅安装到当前用户；桌面和开始菜单快捷方式可启动正确版本。
- “已安装的应用”显示 Jiao_Reader 和卸载入口；安装目录中的卸载程序可用。
- 再次运行同版本安装包可以覆盖安装。后续版本保持 `appId`，验证升级后快捷方式和模型设置可继续使用。
- 卸载阅读器后，程序与快捷方式移除，用户原始 PDF 和 Ollama 模型保持可用。
- 检查未签名提示并记录，不以禁用 SmartScreen 或杀毒软件作为通过条件。

## PDF 阅读

- 打开带文字层的多页论文，滚轮能够从第一页读到最后一页，当前页和总页数始终可见并正确更新。
- 在文档中部连续点击 `+` / `−`、快速交替缩放、使用“适合宽度”；页面不消失、不永久空白，阅读位置保持合理。
- 缩放后仍能选中文字，选择范围与可见文字对齐。
- 向上、向下跨行拖选正文，经过行间空白、页边距和双栏中缝时，不误选全文或突然跳到页尾；分别核对左栏、右栏的选文。
- 在页面底边、阅读视窗边缘和已有选区上再次拖动，选区保持可预期；拖选中滚动时，起点文字层不会被虚拟化回收。
- 单条删除最近阅读后，其余条目和计数更新正确，重启后已删除记录不再显示；清空后列表为空，重启仍为空。
- 删除或清空最近阅读时，不关闭当前文献，不改变当前阅读页；原始 PDF 仍存在且可重新打开。
- 输入有效页码能跳转，超出页数或无效输入不会让页面消失。
- 关闭和重开 PDF、切换到另一篇 PDF 后，页码、缩放和渲染状态正确。
- 打开文件前，首页显示文件打开入口和使用提示；应用图标正常，打包后不包含已移除的首页插画。
- 划选正文后，在选区附近显示翻译进度和译文气泡，右侧面板内容一致；可复制或关闭气泡。
- 在窗口边缘选择文字、缩小窗口或翻译较长段落时，气泡内容仍可阅读，必要时可在气泡内滚动。
- 连续选择不同段落时，较早请求的返回结果不会覆盖当前选区；滚动、缩放和切换论文后不残留失去对应选区的气泡。

## Ollama 与已有模型

- 未安装 Ollama：清楚提示安装方式，PDF 阅读仍正常。
- 已安装但服务停止：显示服务未就绪；启动 Ollama 并刷新后恢复。
- 服务运行、没有本地模型：显示空列表和 Ollama 命令指引，不能发起无效翻译。
- 本机已有多个模型：列表反映已有模型，选中一个后实际翻译请求使用这个模型。
- 重启软件：模型选择保留；在 Ollama 删除所选模型后刷新，界面提示重新选择。
- 模型下载或导入只通过 Ollama 完成；阅读器和安装器都没有自动拉取模型的操作。

## 官方配置参考

- [electron-builder v26：NSIS](https://www.electron.build/v26/docs/nsis/)：向导、安装目录、快捷方式、`customInstallMode`。
- [electron-builder v26：应用内容](https://www.electron.build/v26/docs/contents/)：`files` 白名单与开发依赖排除。
- [electron-builder npm 官方发布页](https://www.npmjs.com/package/electron-builder)：本项目固定使用 26.15.3，核对时 npm `latest` 为该版本。

`build-resources/installer.nsh` 使用官方支持的 include 扩展，强制当前用户安装；未替换默认安装器脚本或卸载流程。Windows 图标由现有 `app/icon.png` 转为多尺寸 ICO。

构建入口 `build-resources/build-installer.cjs` 使用 electron-builder 自带的 `UninstallerReader` 静态提取卸载组件，避免构建时执行临时的未签名 NSIS 引导程序；不修改 Windows 应用程序控制策略。该入口依赖固定版本的内部 API，升级 electron-builder 时需重新验证安装与卸载。
