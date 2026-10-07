# PDF 文字拖选的处理

本次修复参考与内置 PDF.js 相同版本的 [TextLayerBuilder 6.3.289](https://github.com/mozilla/pdf.js/blob/v6.3.289/web/text_layer_builder.js)。底层 `TextLayer` 负责绘制文字覆盖层，官方阅读器还使用 `endOfContent` 和选择状态处理鼠标拖到文字间隙时的边界。本项目在 `app/pdf-selection.mjs` 接入对应逻辑，并保留其 Apache-2.0 来源声明。

- 每个完成渲染的文字层注册选区边界，换文档、缩放或回收时注销。
- Chromium 148 及以上保留浏览器修复后的行为；旧版本才动态移动空白区域边界，避免对新版重复应用旧修复。
- 拖选时保留文字层，选区释放后仍保护涉及的页，避免页面回收删除选区的起点。
- 指针离开阅读窗口时保留最后有效的 PDF 选区，防止其他面板成为选区终点。
- 鼠标位于行末、行间或页边空白时，通过坐标定位同栏最近的文字端点；参考标准浏览器 [caretPositionFromPoint API](https://developer.mozilla.org/en-US/docs/Web/API/Document/caretPositionFromPoint)。明确识别为多栏的正文，以起始栏约束一次拖选，拖过栏缝或另一栏时也延续同栏端点；需要翻译另一栏时重新划选该栏段落。
- PDF 原文禁止浏览器原生文字拖放；重新拖选已有选区时创建新选区。
- 最近阅读的删除操作只修改记录文件，当前文档与原始 PDF 均保留。

部分 PDF 保存的文字顺序与视觉顺序不同，这是 PDF.js 项目也记录过的[文本流顺序问题](https://github.com/mozilla/pdf.js/issues/17191)。`app/text-order.mjs` 对明确的水平、从左到右文字层按空白递归分块：先识别清楚的栏间空隙，保持一整栏的顺序，再排列同栏各行；跨栏标题、页脚通过水平空白与正文区分开。此方法参考 [PdfPig 的 Recursive XY Cut 说明](https://github.com/UglyToad/PdfPig/wiki/Document-Layout-Analysis)。它不对所有文字直接按 y/x 排序，以免把两栏正文逐行交织。

旋转页面、从右向左文字、有结构标记的文字层和无法识别的布局保留原始结构。复杂表格、公式、绕图排版仍可能有阅读顺序歧义；翻译前可检查右侧原文，双栏论文建议一次选择同栏的一段。此改进不提供扫描件 OCR。

回归测试使用真正的 PDF 和鼠标事件，覆盖行末与行间空白、正向与反向拖选、双栏与乱序页脚、阅读窗口外拖动、已有选区再次拖选、缩放、拖选期间不发起翻译以及最近阅读记录的持久化。
