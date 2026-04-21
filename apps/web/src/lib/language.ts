type LanguageMetadata = { label: string; markdown: boolean };

const metadataMap: Record<string, LanguageMetadata> = {
  md: { label: "Markdown", markdown: true },
  markdown: { label: "Markdown", markdown: true },
  json: { label: "JSON", markdown: false },
  yaml: { label: "YAML", markdown: false },
  yml: { label: "YAML", markdown: false },
  xml: { label: "XML", markdown: false },
  html: { label: "HTML", markdown: false },
  htm: { label: "HTML", markdown: false },
  css: { label: "CSS", markdown: false },
  js: { label: "JavaScript", markdown: false },
  jsx: { label: "JavaScript", markdown: false },
  ts: { label: "TypeScript", markdown: false },
  tsx: { label: "TypeScript", markdown: false },
  py: { label: "Python", markdown: false },
  txt: { label: "Text", markdown: false },
  ini: { label: "Text", markdown: false },
  toml: { label: "Text", markdown: false },
  csv: { label: "Text", markdown: false },
  sh: { label: "Text", markdown: false }
};

export function getFileExtension(path: string) {
  const parts = path.split(".");
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() ?? "" : "";
}

export function getLanguageMetadata(path: string): LanguageMetadata {
  const extension = getFileExtension(path);
  return metadataMap[extension] ?? { label: "Text", markdown: false };
}

export function isMarkdownPath(path: string) {
  return getFileExtension(path) === "md" || getFileExtension(path) === "markdown";
}

export function isPdfPath(path: string) {
  return getFileExtension(path) === "pdf";
}
