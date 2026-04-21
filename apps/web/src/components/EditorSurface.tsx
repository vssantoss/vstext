import type { Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { FileText } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { MAX_FULL_FEATURE_FILE_SIZE, MAX_HIGHLIGHT_FILE_SIZE } from "../constants";
import { loadLanguageExtension } from "../lib/languageExtensions";
import type { CursorSnapshot, ResolvedTheme, TextDocument } from "../types";

const MarkdownPreview = lazy(() =>
  import("./MarkdownPreview").then((module) => ({ default: module.MarkdownPreview }))
);

const PdfPreview = lazy(() => import("./PdfPreview").then((module) => ({ default: module.PdfPreview })));

const MIN_PANE_PCT = 15;
const MAX_PANE_PCT = 85;

const BASIC_SETUP = {
  lineNumbers: true,
  highlightActiveLine: true,
  highlightActiveLineGutter: false,
  foldGutter: false
} as const;

const EMPTY_EXTENSIONS: Extension[] = [];

const darkEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--editor-bg)",
      color: "var(--text)",
      height: "100%"
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      padding: "8px 0",
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'
    },
    ".cm-gutters": {
      backgroundColor: "var(--editor-bg)",
      color: "var(--text-dim)",
      border: "none",
      paddingRight: "8px"
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.03)"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--text)"
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "var(--selection) !important"
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--selection) !important"
    },
    ".cm-cursor": {
      borderLeftColor: "var(--accent)"
    },
    ".cm-scroller": {
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
      lineHeight: "1.5"
    }
  },
  { dark: true }
);

const lightEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--editor-bg)",
      color: "var(--text)",
      height: "100%"
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      padding: "8px 0",
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'
    },
    ".cm-gutters": {
      backgroundColor: "var(--editor-bg)",
      color: "var(--text-dim)",
      border: "none",
      paddingRight: "8px"
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(0, 0, 0, 0.03)"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--text)"
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "var(--selection) !important"
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--selection) !important"
    },
    ".cm-cursor": {
      borderLeftColor: "var(--accent)"
    },
    ".cm-scroller": {
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
      lineHeight: "1.5"
    }
  },
  { dark: false }
);

interface EditorSurfaceProps {
  document: TextDocument | null;
  loading?: boolean;
  resolvedTheme: ResolvedTheme;
  previewOpen: boolean;
  onChange: (nextValue: string) => void;
  onCursorChange: (snapshot: CursorSnapshot) => void;
  pdf?: {
    url: string | null;
    error?: string | null;
  };
  mergeReview?: {
    documentName: string;
    currentIndex: number;
    totalCount: number;
    remoteDeviceName: string;
    remoteUpdatedAt: string;
    remoteBody: string;
    onNextDraft: () => void;
    onUseDraftAsBase: () => void;
    onSaveDraftCopy: () => void;
    onSkipFile: () => void;
  } | null;
}

export function EditorSurface(props: EditorSurfaceProps) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const [editorPct, setEditorPct] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const [syntaxExtension, setSyntaxExtension] = useState<Extension | null>(null);

  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const onCursorChangeRef = useRef(props.onCursorChange);
  onCursorChangeRef.current = props.onCursorChange;

  const handleEditorChange = useCallback((value: string) => {
    onChangeRef.current(value);
  }, []);

  const handleEditorUpdate = useCallback((update: ViewUpdate) => {
    const position = update.state.selection.main.head;
    const line = update.state.doc.lineAt(position);
    onCursorChangeRef.current({
      line: line.number,
      column: position - line.from,
      scrollTop: update.view.scrollDOM.scrollTop
    });
  }, []);

  const editorExtensions = useMemo(
    () => (syntaxExtension ? [syntaxExtension] : EMPTY_EXTENSIONS),
    [syntaxExtension]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMove = (event: MouseEvent) => {
      if (!surfaceRef.current) return;
      const rect = surfaceRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      setEditorPct(Math.max(MIN_PANE_PCT, Math.min(MAX_PANE_PCT, pct)));
    };
    const handleUp = () => setIsResizing(false);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!props.document || props.document.isPdf || props.document.size > MAX_HIGHLIGHT_FILE_SIZE) {
      setSyntaxExtension(null);
      return;
    }

    let cancelled = false;
    const path = props.document.path;
    setSyntaxExtension(null);

    void loadLanguageExtension(path).then((extension) => {
      if (!cancelled && props.document?.path === path) {
        setSyntaxExtension(extension);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [props.document?.isPdf, props.document?.path, props.document?.size]);

  if (!props.document) {
    return (
      <section className="editor-surface editor-surface--empty">
        <div className="editor-empty">
          <FileText size={32} className="editor-empty__icon" strokeWidth={1.4} />
          <p className="editor-empty__title">No file open</p>
          <p className="editor-empty__hint">Pick a file from the Explorer or search to start editing.</p>
        </div>
      </section>
    );
  }

  if (props.document.isPdf) {
    return (
      <section ref={surfaceRef} className="editor-surface editor-surface--pdf">
        <Suspense fallback={<div className="pdf-preview pdf-preview--loading" />}>
          <PdfPreview
            url={props.pdf?.url ?? null}
            name={props.document.name}
            error={props.pdf?.error ?? null}
          />
        </Suspense>
      </section>
    );
  }

  if (props.loading) {
    return (
      <section className="editor-surface editor-surface--empty">
        <div className="editor-empty">
          <FileText size={32} className="editor-empty__icon" strokeWidth={1.4} />
          <p className="editor-empty__title">Loading file…</p>
          <p className="editor-empty__hint">{props.document.name}</p>
        </div>
      </section>
    );
  }

  const previewEnabled =
    !props.mergeReview && props.previewOpen && props.document.isMarkdown && props.document.size <= MAX_FULL_FEATURE_FILE_SIZE;
  const mergeEnabled = Boolean(props.mergeReview);
  const nextLabel =
    props.mergeReview && props.mergeReview.currentIndex + 1 >= props.mergeReview.totalCount ? "Resolve file" : "Next draft";
  const splitStyle =
    previewEnabled || mergeEnabled ? ({ "--editor-pct": `${editorPct}%` } as CSSProperties) : undefined;

  return (
    <section
      ref={surfaceRef}
      className={`editor-surface ${
        mergeEnabled ? "editor-surface--merge" : previewEnabled ? "editor-surface--split" : ""
      } ${isResizing ? "editor-surface--resizing" : ""}`}
      style={splitStyle}
    >
      {props.mergeReview ? (
        <div className="merge-review">
          <div className="merge-review__header">
            <div>
              <strong>{props.mergeReview.documentName}</strong>
              <p>
                Draft {props.mergeReview.currentIndex + 1} of {props.mergeReview.totalCount} from{" "}
                <strong>{props.mergeReview.remoteDeviceName}</strong> saved at{" "}
                <strong>{new Date(props.mergeReview.remoteUpdatedAt).toLocaleString()}</strong>
              </p>
            </div>
            <div className="merge-review__actions">
              <button type="button" className="button button--ghost" onClick={props.mergeReview.onSkipFile}>
                Skip file
              </button>
              <button type="button" className="button button--ghost" onClick={props.mergeReview.onSaveDraftCopy}>
                Save draft copy
              </button>
              <button type="button" className="button button--ghost" onClick={props.mergeReview.onUseDraftAsBase}>
                Use draft as base
              </button>
              <button type="button" className="button" onClick={props.mergeReview.onNextDraft}>
                {nextLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="editor-surface__pane">
        <CodeMirror
          className="editor-surface__editor"
          value={props.document.cachedBody}
          height="100%"
          theme={props.resolvedTheme === "dark" ? darkEditorTheme : lightEditorTheme}
          extensions={editorExtensions}
          basicSetup={BASIC_SETUP}
          onChange={handleEditorChange}
          onUpdate={handleEditorUpdate}
        />
      </div>

      {previewEnabled || mergeEnabled ? (
        <div
          className={`editor-surface__resize-handle ${isResizing ? "editor-surface__resize-handle--active" : ""}`}
          role="separator"
          aria-orientation="vertical"
          onMouseDown={(event) => {
            event.preventDefault();
            setIsResizing(true);
          }}
          onDoubleClick={() => setEditorPct(50)}
        />
      ) : null}

      {props.mergeReview ? (
        <aside className="editor-surface__preview merge-preview">
          <div className="merge-preview__header">
            <h3>Remote draft</h3>
            <span>{props.mergeReview.remoteDeviceName}</span>
          </div>
          <pre>{props.mergeReview.remoteBody}</pre>
        </aside>
      ) : null}

      {previewEnabled ? (
        <Suspense fallback={<div className="editor-surface__preview markdown-preview markdown-preview--loading" />}>
          <MarkdownPreview body={props.document.cachedBody} />
        </Suspense>
      ) : null}
    </section>
  );
}
