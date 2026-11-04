// Repair legacy encoded punctuation for presentation without changing API records.
const punctuation = [
  ['\u00c2\u00b0', '\u00b0'], ['\u00c2\u00b7', '\u00b7'],
  ['\u00e2\u2030\u00a5', '\u2265'], ['\u00e2\u2030\u00a4', '\u2264'],
  ['\u00e2\u20ac\u201d', '\u2014'], ['\u00e2\u20ac\u201c', '\u2013'],
  ['\u00e2\u20ac\u00a2', '\u2022'], ['\u00e2\u20ac\u2122', '\u2019'],
  ['\u00e2\u20ac\u00a6', '\u2026'], ['\u00c3\u2014', '\u00d7'],
];

export function displayText(value) {
  if (typeof value !== 'string') return value;
  return punctuation.reduce((text, [encoded, decoded]) => text.replaceAll(encoded, decoded), value);
}
