const replacements: Array<[RegExp, string]> = [
  [/Ã¢â‚¬â€/g, "-"],
  [/Ã¢â‚¬â€œ/g, "-"],
  [/Ã‚Â·/g, "-"],
  [/Ã‚Â²/g, "2"]
];

export function text(value: string) {
  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}
