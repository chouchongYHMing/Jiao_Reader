// Recover a conservative reading order from clear whitespace between text blocks.
// Recursive XY cuts keep columns together instead of interleaving them by y/x.
// Tagged, rotated and RTL layouts retain PDF.js's original structure.
export function orderTextLayer(layer, content, viewport) {
  if (viewport.rotation || content.items.some(item => item.dir && item.dir !== 'ltr') ||
      layer.querySelector('.markedContent, span[role="img"]')) return;
  const children = Array.from(layer.children);
  if (children.some(node => !['SPAN', 'BR'].includes(node.tagName))) return;
  const entries = [];
  for (const node of children) {
    if (node.tagName === 'BR') {
      if (!entries.length) return;
      entries.at(-1).nodes.push(node);
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (!node.textContent.trim() || !rect.width || !rect.height) {
      if (!entries.length) return;
      // PDF.js emits explicit space spans between separate PDF text operators.
      // Keep their text/breaks with the preceding run, without treating them as blocks.
      entries.at(-1).nodes.push(node);
      continue;
    }
    entries.push({ nodes: [node], left: rect.left, right: rect.right, top: rect.top,
      bottom: rect.bottom, height: rect.height, index: entries.length });
  }
  if (entries.length < 2 || entries.length > 5000) return;
  const heights = entries.map(entry => entry.height).sort((a, b) => a - b);
  const lineHeight = heights[Math.floor(heights.length / 2)];

  function cut(items, axis, minimum) {
    const start = axis === 'x' ? 'left' : 'top';
    const end = axis === 'x' ? 'right' : 'bottom';
    const sorted = items.slice().sort((a, b) => a[start] - b[start]);
    const prefixTop = [], prefixBottom = [], suffixTop = [], suffixBottom = [];
    for (let i = 0; i < sorted.length; i++) {
      prefixTop[i] = Math.min(prefixTop[i - 1] ?? Infinity, sorted[i].top);
      prefixBottom[i] = Math.max(prefixBottom[i - 1] ?? -Infinity, sorted[i].bottom);
    }
    for (let i = sorted.length - 1; i >= 0; i--) {
      suffixTop[i] = Math.min(suffixTop[i + 1] ?? Infinity, sorted[i].top);
      suffixBottom[i] = Math.max(suffixBottom[i + 1] ?? -Infinity, sorted[i].bottom);
    }
    let edge = sorted[0][end];
    let best;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i][start] - edge;
      if (gap >= minimum && (!best || gap > best.gap)) {
        // A vertical cut needs multi-line blocks, not merely a space between words.
        if (axis !== 'x' || (i >= 2 && sorted.length - i >= 2 &&
          prefixBottom[i - 1] - prefixTop[i - 1] >= lineHeight * 2 &&
          suffixBottom[i] - suffixTop[i] >= lineHeight * 2)) {
          best = { gap, index: i };
        }
      }
      edge = Math.max(edge, sorted[i][end]);
    }
    return best && { first: sorted.slice(0, best.index), second: sorted.slice(best.index) };
  }

  function rowsFor(items) {
    const rows = [];
    for (const item of items.slice().sort((a, b) => a.top - b.top || a.index - b.index)) {
      const row = rows.at(-1);
      const overlap = row && Math.min(row.bottom, item.bottom) - Math.max(row.top, item.top);
      if (row && overlap >= Math.min(row.height, item.height) * 0.5) {
        row.items.push(item);
      } else rows.push({ top: item.top, bottom: item.bottom, height: item.height, items: [item] });
    }
    return rows;
  }

  function lines(items) {
    const rows = rowsFor(items);
    const gaps = [];
    for (const row of rows) {
      const sorted = row.items.slice().sort((a, b) => a.left - b.left || a.index - b.index);
      let edge = sorted[0].right;
      for (const item of sorted.slice(1)) {
        if (item.left - edge >= Math.max(6, lineHeight * 0.5)) {
          // Repeated narrow gutters can be columns or a table. Don't interleave them.
          if (gaps.some(gap => gap.row !== row && Math.min(gap.right, item.left) -
            Math.max(gap.left, edge) >= Math.max(4, lineHeight * 0.3))) {
            return items.slice().sort((a, b) => a.index - b.index);
          }
          gaps.push({ row, left: edge, right: item.left });
        }
        edge = Math.max(edge, item.right);
      }
    }
    return rows.flatMap(row => row.items.sort((a, b) => a.left - b.left || a.index - b.index));
  }

  function order(items, depth = 0, column = '') {
    if (items.length < 2 || depth > 16) return items.map(item => ({ ...item, column }));
    const vertical = cut(items, 'x', Math.max(18, lineHeight * 1.5));
    const split = vertical || cut(items, 'y', Math.max(8, lineHeight));
    return split ? [...order(split.first, depth + 1, vertical ? `${column}L` : column),
      ...order(split.second, depth + 1, vertical ? `${column}R` : column)] :
      lines(items).map(item => ({ ...item, column }));
  }
  const ordered = order(entries);
  for (const item of ordered) {
    if (item.column) {
      for (const node of item.nodes) if (node.tagName === 'SPAN') node.dataset.selectionColumn = item.column;
    }
  }
  if (ordered.every((item, index) => item.index === index)) return;
  const fragment = document.createDocumentFragment();
  for (const entry of ordered) fragment.append(...entry.nodes);
  layer.append(fragment);
}
