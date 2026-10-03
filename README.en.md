# Jiao_Reader

[简体中文](README.md) | [English](README.en.md) | [Català](README.ca.md) | [Español](README.es.md)

Project: [chouchongYHMing/Jiao_Reader](https://github.com/chouchongYHMing/Jiao_Reader) · Downloads: [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases)

A local PDF reader for academic papers on Windows 10 / 11 x64. It uses PDF.js to display papers and models already installed in your local Ollama instance to translate selected text.

A personal reading tool, currently at version `0.3.0`. The empty screen features fan art of Takamatsu Tomori reading at her desk. Once you open a paper, select text to see its translation in a nearby popup; the right panel keeps the full source text and translation.

**The application interface is currently in Simplified Chinese, and selected text is translated into Simplified Chinese.** These README translations do not indicate that the application has a multilingual interface.

## For readers: install and start reading

1. Download `Jiao_Reader-Setup-0.3.0.exe` from [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases), then run the installer. The `Source code` downloads contain the source code; to use the application, choose Setup.
2. Open Jiao_Reader from the desktop or Start menu, then open or drag in a PDF.
3. Use the mouse wheel to read continuously. The top toolbar shows the current page and total page count. Enter a page number to jump to it, or use `+`, `−`, and “适合宽度” (Fit width) to adjust the view.

The installer includes the desktop runtime. Readers do not need to install Node.js, Python, or development tools. Installation is restricted to the current Windows user. You can choose another installation folder if you have permission to write to it. The installer creates Start menu and desktop shortcuts and an uninstall entry in Windows Installed apps. The default installation location does not require administrator privileges.

**The current release is not code signed.** Windows SmartScreen or your browser may display an “Unknown publisher” or “Windows protected your PC” warning. This is unrelated to whether Node.js or Python is installed. Verify the download source before proceeding. Code signing and publisher reputation are tasks for a future release; users should not be asked to disable system protection.

For the full first-use instructions, see the [Quick start guide (Chinese)](docs/QUICKSTART.zh-CN.md).

## Set up local translation

Reading PDFs does not require Ollama. To translate text:

1. Install and start [Ollama for Windows](https://ollama.com/download/windows).
2. In PowerShell, use Ollama to download the model you want to use. For example, the original project uses:

   ```powershell
   ollama pull qwen3:4b-instruct
   ollama list
   ```

3. Return to Jiao_Reader, refresh the local model status, and select an installed model in the model panel.
4. Select a passage in a paper. A popup near the selection displays translation progress and the result, while the right panel also keeps the source text and translation.

On startup, the application checks whether local Ollama is available and displays its connection, installation, and local model status. If Ollama is installed but its service is not running, click “启动 Ollama” (Start Ollama). You can also open Ollama yourself or run `ollama serve` in a terminal. After downloading a model, refresh the list to use it. The application remembers your chosen model; if that model has been removed, you will need to select another one.

**The model panel only selects local models already available in Ollama.** It does not download models, accept arbitrary model names, or import GGUF files by dragging them into the application. Prepare new models with `ollama pull` or Ollama's own import commands. The installer does not include Ollama or any models, and it does not install them automatically.

Disk, RAM, and video memory requirements depend on the model you choose. The first translation may take longer while Ollama loads the model into memory. Changing models can affect translation speed and quality. See the [official Ollama documentation](https://docs.ollama.com/quickstart) for model setup instructions.

## Reading and translation

| Action | How |
| --- | --- |
| Open a paper | Click “打开 PDF” (Open PDF), drag in a file, or press `Ctrl+O` |
| Read continuously | Use the mouse wheel or the scrollbar on the right |
| Check your position | See the page number at the top and “第 X 页 / 共 N 页” (Page X of N) at the bottom; both update as you scroll |
| Jump to a page | Enter and confirm a page number in the top toolbar |
| Zoom | Use `+`, `−`, “适合宽度” (Fit width), or `Ctrl++` / `Ctrl+-` |
| Translate | Select a passage in the PDF text layer and read the translation in the popup near the selection |
| Copy a translation | Use the copy button in the popup or the translation card on the right |
| Change models | Refresh the model list and select a model installed locally |

PDF files are read locally. Selected text is sent to the local endpoint `127.0.0.1:11434`. PDFs must have an extractable text layer; scanned documents need OCR first. The maximum PDF size is 200 MB, and each translation is limited to 3,000 characters. Translation history is kept only for the current application session.

## Development and packaging

The following commands are for project maintainers. Readers installing a release do not need to run them. Development requires Windows x64 and Node.js 22.12 or later. Installing build dependencies and downloading Electron and the NSIS tools for the first time requires an internet connection.

```powershell
git clone https://github.com/chouchongYHMing/Jiao_Reader.git
cd Jiao_Reader
npm ci
npm run check
npm start
```

Build a distributable installer:

```powershell
npm run build:win
```

Output: `release\Jiao_Reader-Setup-0.3.0.exe`. Share this single installer with other readers. You do not need to send `node_modules`, the source code, the application build folder, or your own Ollama model files.

Build only the application folder `dist\Jiao_Reader-win32-x64` for validation:

```powershell
npm run build:win:dir
```

The original portable packaging command is also available:

```powershell
npm run package:win
```

The portable application starts from `dist\Jiao_Reader-win32-x64\Jiao_Reader.exe`. To share the portable version, archive the entire `Jiao_Reader-win32-x64` folder. Copying only its `.exe` file will not work. Neither the installer nor the portable version includes Ollama or models.

Installer settings are in `electron-builder.yml`. Keep `appId: com.jiao.reader` stable so future installers recognize the same application. `build-resources/installer.nsh` enforces installation for the current user, and electron-builder provides the default uninstall process. The build entry point first creates the application using the file allowlist in `package-portable.cjs`, then uses electron-builder's `prepackaged` option to wrap it in an NSIS installer. Both distribution formats contain the same application. Runtime code, PDF.js resources, and licenses are included, along with the README files and user documentation in the application folder.

For checks to run before publishing, see [Windows release validation (Chinese)](docs/RELEASE_CHECKLIST.md).

## Publishing on GitHub

Commit the source code to the GitHub repository. Upload the Setup installer and `SHA256SUMS.txt` as **Release assets**. Readers can download Setup from Releases and prepare their models separately with Ollama. For the full repository creation, push, and release instructions, see the [GitHub publishing guide (Chinese)](docs/GITHUB_RELEASE.zh-CN.md).

## Project structure

```text
main.cjs                      Electron main process, window, PDF file operations, and desktop APIs
ollama.cjs                    Ollama detection, model listing, and local translation
preload.cjs                   Restricted desktop APIs exposed to the page
app/                          Reading interface, PDF rendering, and interaction modules
app/pdfjs/                    PDF.js, character maps, and font resources
electron-builder.yml          Windows NSIS installer configuration
build-resources/              Windows icons, installation mode, and portable packaging scripts
docs/                         First-use instructions and release validation documentation
```

## Relationship to Jiao_Translator

Jiao_Reader draws on Jiao_Translator's PDF.js reader and local translation prompts. The desktop version calls Ollama's local API directly. The PDF.js license is in `app/pdfjs/LICENSE`; font licenses are distributed with `app/pdfjs/standard_fonts/`. See the original project: [Jiao_Translator](https://github.com/chouchongYHMing/Jiao_Translator).
