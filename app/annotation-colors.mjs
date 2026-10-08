export const ANNOTATION_COLORS = Object.freeze([
  Object.freeze({ id: 'amber', label: '麦穗黄', hex: '#FFE295', ink: '#69521D', border: '#D8B860' }),
  Object.freeze({ id: 'sage', label: '鼠尾草绿', hex: '#A4D4B7', ink: '#315B43', border: '#74AE8D' }),
  Object.freeze({ id: 'blue', label: '雾蓝', hex: '#A8CFEC', ink: '#35566F', border: '#7DADCF' }),
  Object.freeze({ id: 'violet', label: '淡紫', hex: '#C9B4E5', ink: '#604A79', border: '#A58AC8' }),
  Object.freeze({ id: 'peach', label: '杏橙', hex: '#F6BF9E', ink: '#795034', border: '#D99873' }),
  Object.freeze({ id: 'rose', label: '柔珊瑚', hex: '#EAA8AD', ink: '#783F48', border: '#CC828C' })
]);

const palette = new Map(ANNOTATION_COLORS.map(color => [color.id, color]));

export function normalizeColor(color) {
  return palette.has(color) ? color : 'amber';
}

export function colorForTag(note, tag) {
  const colors = note?.tagColors;
  const color = colors && Object.hasOwn(colors, tag) ? colors[tag] : note?.color;
  return normalizeColor(color);
}

export function noteColor(note) {
  return note?.tags?.length ? colorForTag(note, note.tags[0]) : normalizeColor(note?.color);
}

// Only known palette values enter CSS, including when reading older note data.
export function applyColor(element, color) {
  const id = normalizeColor(color);
  const value = palette.get(id);
  element.dataset.color = id;
  element.style.setProperty('--annotation-color', value.hex);
  element.style.setProperty('--annotation-ink', value.ink);
  element.style.setProperty('--annotation-border', value.border);
  return id;
}
