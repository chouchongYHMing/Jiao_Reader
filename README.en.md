# Jiao_Reader

[简体中文](README.md) | [English](README.en.md) | [Català](README.ca.md) | [Español](README.es.md)

Project: [chouchongYHMing/Jiao_Reader](https://github.com/chouchongYHMing/Jiao_Reader) · Downloads: [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases)

A local PDF reader for academic papers on Windows 10 / 11 x64. It uses PDF.js to display papers and models already installed in your local Ollama instance to translate selected text.

A personal reading tool, currently at version `0.3.4`. Once you open a paper, select text to see its translation in a nearby popup; the right panel keeps the full source text and translation.

**The application interface is currently in Simplified Chinese, and selected text is translated into Simplified Chinese.** These README translations do not indicate that the application has a multilingual interface.

## For readers: install and start reading

1. Download `Jiao_Reader-Setup-0.3.4.exe` from [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases), then run the installer. The `Source code` downloads contain the source code; to use the application, choose Setup.
2. Open Jiao_Reader from the desktop or Start menu, then open or drag in a PDF.
3. Use the mouse wheel to read continuously. The top toolbar shows the current page and total page count. Enter a page number to jump to it, or use `+`, `−`, and “适合宽度” (Fit width) to adjust the view.

The `0.3.4` release reuses the unchanged Electron launcher from `0.3.1`. Windows `.exe` file properties may therefore still show `0.3.1`; the application and installer versions are `0.3.4`.

The installer includes the desktop runtime. Readers do not need to install Node.js, Python, or development tools. Installation is restricted to the current Windows user. You can choose another installation folder if you have permission to write to it. The installer creates Start menu and desktop shortcuts and an uninstall entry in Windows Installed apps. The default installation location does not require administrator privileges.

**The current release is not code signed.** Windows SmartScreen or your browser may display an “Unknown publisher” or “Windows protected your PC” warning. This is unrelated to whether Node.js or Python is installed. Verify the download source before proceeding. Code signing and publisher reputation are tasks for a future release; users should not be asked to disable system protection.

For the full first-use instructions, see the [Quick start guide (Chinese)](docs/QUICKSTART.zh-CN.md).

**Upgrade from an older version:** close Jiao_Reader and run the new Setup using the same installation folder. You do not need to uninstall first. Recent papers, priorities, saved notes, and your model selection are retained; Ollama and the original PDFs are unaffected. There is no automatic updater. For a portable version, replace the entire application folder; Setup does not update a portable copy in another location.

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
| Manage recent papers | Remove one entry with its delete button, or use “清空” (Clear) to remove all entries; the original PDFs are kept |
| Set reading priorities | Right-click a recent paper and choose “优先级 +1” (Increase priority by 1) or “优先级清零” (Reset priority); its badge shows the priority |
| Add tags or notes | Select text, then right-click its entry in “本次阅读” (This reading session) at the bottom right and choose “添加标签” (Add tags) or “写评论 / 笔记” (Write a comment / note) |
| View saved annotations | Click “标签与笔记” (Tags and notes), to the right of the document title and left of the page controls; jump to a page, edit, or delete a note |

Drag selection handles gaps between lines, page margins, and two-column text more reliably, reducing sudden expansion of the selection or jumps to the bottom of a page. For clearly detected columns, each drag stays in its starting column; start a new selection to translate the other column. For complex layouts, check that the source text in the right panel matches your intended selection. Removing recent entries only changes the list: it neither deletes PDFs from disk nor closes the paper currently open.

Recent papers are sorted by **priority from highest to lowest, then by most recent reading time**. Their right-click menu contains only the increase and reset actions. Priorities are stored locally with the recent-paper records.

Tags, comments, notes, and annotations do not require Ollama. Every text selection creates a reading-session entry with its source text and page, so you can annotate it before translating. Separate tags with commas; a selection's tags and note can be edited together. The top list shows the most recently updated notes first, with their source quotes and page numbers.

Tags offer six soft highlighter colors: wheat yellow, sage green, mist blue, lavender, apricot, and soft coral. Choose a color for each tag in the editor; saved tags and their PDF passages are highlighted. A passage with several tags uses its first tag’s color. Comment-only notes can also have a highlight color. Within a document, the same tag has one consistent color; recoloring it updates its related passages.

Click a tag above the list to collect its related passages and notes. Each passage keeps its own comment, sorted by its last edit; comments do not overwrite one another. Choose “全部” (All) to return to the complete list. New annotations save their page positions, so highlights survive zoom and restart. Older annotations receive highlights only when their quotation matches uniquely. Highlights stay in the reader and do not write into the PDF.

Saved annotations are stored locally and survive restarts. A copied or renamed PDF with exactly the same content keeps the same annotations. Notes do not modify or write into the PDF. Reading-session selections and translations are **temporary records for the document currently open** and are cleared when switching documents or restarting; saved tags and notes remain available independently.

PDF files are read locally. When translating, selected text is sent to the local endpoint `127.0.0.1:11434`. PDFs must have an extractable text layer; scanned documents need OCR first. The maximum PDF size is 200 MB, and each translation is limited to 3,000 characters. Each annotation can quote up to 12,000 characters and contain up to 20 tags (50 characters each) and a 6,000-character note.

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

Output: `release\Jiao_Reader-Setup-0.3.4.exe`. Share this single installer with other readers. You do not need to send `node_modules`, the source code, the application build folder, or your own Ollama model files.

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
reading-store.cjs             Local recent-paper records, priorities, and annotations linked to PDF content
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
