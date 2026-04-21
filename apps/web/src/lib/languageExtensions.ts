import type { Extension } from "@codemirror/state";
import { getFileExtension } from "./language";

type ExtensionLoader = () => Promise<Extension | null>;

const extensionLoaders: Record<string, ExtensionLoader> = {
  md: async () => {
    const { markdown } = await import("@codemirror/lang-markdown");
    return markdown({ codeLanguages: [] });
  },
  markdown: async () => {
    const { markdown } = await import("@codemirror/lang-markdown");
    return markdown({ codeLanguages: [] });
  },
  json: async () => {
    const { json } = await import("@codemirror/lang-json");
    return json();
  },
  yaml: async () => {
    const { yaml } = await import("@codemirror/lang-yaml");
    return yaml();
  },
  yml: async () => {
    const { yaml } = await import("@codemirror/lang-yaml");
    return yaml();
  },
  xml: async () => {
    const { xml } = await import("@codemirror/lang-xml");
    return xml();
  },
  html: async () => {
    const { html } = await import("@codemirror/lang-html");
    return html();
  },
  htm: async () => {
    const { html } = await import("@codemirror/lang-html");
    return html();
  },
  css: async () => {
    const { css } = await import("@codemirror/lang-css");
    return css();
  },
  js: async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ jsx: true });
  },
  jsx: async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ jsx: true });
  },
  ts: async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ typescript: true });
  },
  tsx: async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ typescript: true, jsx: true });
  },
  py: async () => {
    const { python } = await import("@codemirror/lang-python");
    return python();
  }
};

const extensionCache = new Map<string, Promise<Extension | null>>();

export function loadLanguageExtension(path: string): Promise<Extension | null> {
  const extension = getFileExtension(path);
  if (!extension) {
    return Promise.resolve(null);
  }

  const cached = extensionCache.get(extension);
  if (cached) {
    return cached;
  }

  const loader = extensionLoaders[extension];
  const pending = loader ? loader() : Promise.resolve(null);
  extensionCache.set(extension, pending);
  return pending;
}
