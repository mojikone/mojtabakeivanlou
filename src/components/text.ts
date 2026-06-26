const replacements: Array<[RegExp, string]> = [
  [/\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u20ac\u009d/g, "-"],
  [/\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u20ac\u0153/g, "-"],
  [/\u00c3\u00e2\u201a\u00c2\u00b7/g, "-"],
  [/\u00c3\u00e2\u201a\u00c2\u00b2/g, "2"],
  [/\u00e2\u20ac\u201d/g, "-"],
  [/\u00e2\u20ac\u201c/g, "-"],
  [/\u00c2\u00b7/g, "-"],
  [/\u00c2\u00b2/g, "2"]
];

export function text(value: string) {
  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}
