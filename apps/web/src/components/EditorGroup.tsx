import { Fragment, Suspense, lazy, memo, useCallback } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { FileText } from "lucide-react";
import { TabStrip } from "./Shell";
import type { TabDragIndicator } from "./Shell";
import type { CursorSnapshot, ResolvedTheme, TextDocument } from "../types";

const EditorSurface = lazy(() =>
  import("./EditorSurface").then((module) => ({ default: module.EditorSurface }))
);

function EditorSurfacePlaceholder({ loading = false }: { loading?: boolean }) {
  return (
    <section className="editor-surface editor-surface--empty">
      <div className="editor-empty">
        <FileText size={32} className="editor-empty__icon" strokeWidth={1.4} />
        <p className="editor-empty__title">{loading ? "Loading editor…" : "No file open"}</p>
        {loading ? null : (
          <p className="editor-empty__hint">Pick a file from the Explorer or search to start editing.</p>
        )}
      </div>
    </section>
  );
}

export interface EditorGroupTabInfo {
  id: string;
  name: string;
  dirty: boolean;
  pendingDraftCount: number;
}

export interface EditorGroupMergeReview {
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
}

export interface EditorGroupViewState {
  id: string;
  openTabs: string[];
  activeTabId: string | null;
  previewTabId: string | null;
}

export interface EditorGroupProps {
  group: EditorGroupViewState;
  groupIndex: number;
  isActiveGroup: boolean;
  isDropTargetGroup: boolean;
  basis: number;
  groupDocument: TextDocument | null;
  needsEditor: boolean;
  showLoadingEditor: boolean;
  isLoadingActiveFile: boolean;
  showMergeReview: boolean;
  resolvedTheme: ResolvedTheme;
  previewOpen: boolean;
  pdfUrl: string | null;
  pdfError: string | null;
  tabDrag: TabDragIndicator | null;
  mergeReviewData: EditorGroupMergeReview | null;
  showResizeHandle: boolean;
  resizingActive: boolean;
  canSplitRight: boolean;

  // stable handlers (pass these via useStableCallback in the parent)
  getDocument: (id: string) => EditorGroupTabInfo | undefined;
  onActivateTab: (documentId: string, groupId: string) => void;
  onPromoteTab: (documentId: string, groupId: string) => void;
  onCloseTab: (documentId: string, groupId: string) => void;
  onTabDragStart: (fromGroupId: string, documentId: string) => void;
  onTabDragOver: (overGroupId: string, overTabId: string | null, before: boolean) => void;
  onTabDrop: (toGroupId: string, anchorTabId: string | null, before: boolean) => void;
  onTabDragEnd: () => void;
  onSplitRight: (sourceGroupId: string) => void;
  onFocusGroup: (groupId: string) => void;
  onUpdateDocument: (nextValue: string) => void;
  onCursorChange: (snapshot: CursorSnapshot) => void;
  onStartResize: (groupIndex: number) => void;
}

function EditorGroupImpl(props: EditorGroupProps) {
  const {
    group,
    groupIndex,
    isActiveGroup,
    isDropTargetGroup,
    basis,
    groupDocument,
    needsEditor,
    showLoadingEditor,
    isLoadingActiveFile,
    showMergeReview,
    resolvedTheme,
    previewOpen,
    pdfUrl,
    pdfError,
    tabDrag,
    mergeReviewData,
    showResizeHandle,
    resizingActive,
    canSplitRight,
    getDocument,
    onActivateTab,
    onPromoteTab,
    onCloseTab,
    onTabDragStart,
    onTabDragOver,
    onTabDrop,
    onTabDragEnd,
    onSplitRight,
    onFocusGroup,
    onUpdateDocument,
    onCursorChange,
    onStartResize
  } = props;

  const groupId = group.id;

  const handleActivate = useCallback((id: string) => onActivateTab(id, groupId), [onActivateTab, groupId]);
  const handlePromote = useCallback((id: string) => onPromoteTab(id, groupId), [onPromoteTab, groupId]);
  const handleClose = useCallback((id: string) => onCloseTab(id, groupId), [onCloseTab, groupId]);
  const handleTabDragStartBound = useCallback(
    (documentId: string) => onTabDragStart(groupId, documentId),
    [onTabDragStart, groupId]
  );
  const handleTabDragOverBound = useCallback(
    (overTabId: string | null, before: boolean) => onTabDragOver(groupId, overTabId, before),
    [onTabDragOver, groupId]
  );
  const handleTabDropBound = useCallback(
    (anchorTabId: string | null, before: boolean) => onTabDrop(groupId, anchorTabId, before),
    [onTabDrop, groupId]
  );
  const handleSplitRight = useCallback(() => onSplitRight(groupId), [onSplitRight, groupId]);
  const handleMouseDownCapture = useCallback(() => onFocusGroup(groupId), [onFocusGroup, groupId]);

  const handleSurfaceDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!tabDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      onTabDragOver(groupId, null, false);
    },
    [tabDrag, onTabDragOver, groupId]
  );

  const handleSurfaceDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!tabDrag) return;
      event.preventDefault();
      onTabDrop(groupId, null, false);
    },
    [tabDrag, onTabDrop, groupId]
  );

  const handleResizeMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      onStartResize(groupIndex);
    },
    [onStartResize, groupIndex]
  );

  const style: CSSProperties = { flexBasis: `${basis}%` };

  return (
    <Fragment>
      <div
        className={`editor-group ${isActiveGroup ? "editor-group--active" : ""} ${
          isDropTargetGroup ? "editor-group--drop-target" : ""
        }`}
        style={style}
        onMouseDownCapture={handleMouseDownCapture}
      >
        <TabStrip
          groupId={groupId}
          openTabs={group.openTabs}
          activeTabId={group.activeTabId}
          previewTabId={group.previewTabId}
          tabDrag={tabDrag}
          getDocument={getDocument}
          onActivate={handleActivate}
          onPromote={handlePromote}
          onClose={handleClose}
          onTabDragStart={handleTabDragStartBound}
          onTabDragOver={handleTabDragOverBound}
          onTabDrop={handleTabDropBound}
          onTabDragEnd={onTabDragEnd}
          onSplitRight={canSplitRight ? handleSplitRight : undefined}
        />
        <div className="editor-group__surface" onDragOver={handleSurfaceDragOver} onDrop={handleSurfaceDrop}>
          {needsEditor ? (
            showLoadingEditor ? (
              <EditorSurfacePlaceholder loading={isLoadingActiveFile} />
            ) : (
              <Suspense fallback={<EditorSurfacePlaceholder loading />}>
                <EditorSurface
                  document={groupDocument}
                  resolvedTheme={resolvedTheme}
                  previewOpen={previewOpen}
                  onChange={onUpdateDocument}
                  onCursorChange={onCursorChange}
                  pdf={
                    groupDocument?.isPdf
                      ? { url: pdfUrl, error: pdfError }
                      : undefined
                  }
                  mergeReview={showMergeReview ? mergeReviewData : null}
                />
              </Suspense>
            )
          ) : (
            <EditorSurfacePlaceholder />
          )}
        </div>
      </div>
      {showResizeHandle ? (
        <div
          className={`editor-group__resize-handle ${
            resizingActive ? "editor-group__resize-handle--active" : ""
          }`}
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleResizeMouseDown}
        />
      ) : null}
    </Fragment>
  );
}

export const EditorGroup = memo(EditorGroupImpl);
