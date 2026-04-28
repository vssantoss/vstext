import { memo, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  AlertCircle,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Cloud,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileCode,
  FileJson,
  FilePlus,
  FileText,
  FileType,
  Files,
  Folder,
  FolderPlus,
  FolderOpen,
  History,
  Image,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Save,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Sparkles,
  Columns2,
  SplitSquareVertical,
  Sun,
  Monitor,
  Moon,
  Pencil,
  Trash2,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ACTIVITY_ITEMS, APP_NAME } from "../constants";
import type {
  ActivityId,
  FileTreeNode,
  ProviderStatus,
  SearchEntry,
  SessionCompareItem,
  ThemeMode,
  WorkspaceScanProgress
} from "../types";

const ACTIVITY_ICON_MAP: Record<ActivityId, LucideIcon> = {
  files: FolderOpen,
  search: SearchIcon,
  sessions: History,
  providers: Cloud,
  settings: SettingsIcon
};

function getFileIcon(name: string): LucideIcon {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return FileText;
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return FileText;
  if (lower.endsWith(".json")) return FileJson;
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return FileCode;
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xml")) return FileCode;
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".jsx")
  )
    return Braces;
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".svg")
  )
    return Image;
  if (lower.endsWith(".py") || lower.endsWith(".sh")) return FileCode;
  return FileType;
}

/* =====================================================================
 * TitleBar
 * =================================================================== */

interface TitleBarProps {
  workspaceName: string;
  sidebarOpen: boolean;
  previewOpen: boolean;
  canToggleSidebar: boolean;
  canTogglePreview: boolean;
  bundleLinked: boolean;
  onOpenLocalWorkspace: () => void;
  onOpenWorkspaceBundle: () => void;
  onChangeSaveLocation: () => void;
  onSaveFile: () => void;
  onSaveSession: () => void;
  onToggleSidebar: () => void;
  onTogglePreview: () => void;
}

export function TitleBar(props: TitleBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <div className="titlebar__brand-mark" aria-hidden>
          <Sparkles size={10} />
        </div>
        <span className="titlebar__app-name">{APP_NAME}</span>
        <span className="titlebar__workspace">{props.workspaceName}</span>
      </div>

      <div className="titlebar__spacer" />

      <div className="titlebar__actions">
        <button
          type="button"
          className="titlebar__button titlebar__button--icon"
          title={props.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          onClick={props.onToggleSidebar}
          disabled={!props.canToggleSidebar}
        >
          {props.sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <button
          type="button"
          className="titlebar__button titlebar__button--icon"
          title={props.previewOpen ? "Hide preview" : "Show preview"}
          onClick={props.onTogglePreview}
          disabled={!props.canTogglePreview}
        >
          <SplitSquareVertical size={16} />
        </button>
        <button
          type="button"
          className="titlebar__button titlebar__button--icon"
          title="Save file (Ctrl+S)"
          onClick={props.onSaveFile}
        >
          <Save size={16} />
        </button>

        <div className="menu" ref={menuRef}>
          <button
            type="button"
            className="titlebar__button titlebar__button--icon"
            title="More actions"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen ? (
            <div className="menu__panel" role="menu">
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  props.onOpenLocalWorkspace();
                  setMenuOpen(false);
                }}
              >
                <FolderOpen size={14} />
                <span className="menu__label">Open Folder…</span>
                <span className="menu__shortcut">Ctrl+K O</span>
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  props.onOpenWorkspaceBundle();
                  setMenuOpen(false);
                }}
              >
                <History size={14} />
                <span className="menu__label">Open Workspace Bundle…</span>
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  props.onSaveFile();
                  setMenuOpen(false);
                }}
              >
                <Save size={14} />
                <span className="menu__label">Save File</span>
                <span className="menu__shortcut">Ctrl+S</span>
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  props.onSaveSession();
                  setMenuOpen(false);
                }}
              >
                <History size={14} />
                <span className="menu__label">Save Session</span>
              </button>
              {props.bundleLinked ? (
                <button
                  type="button"
                  className="menu__item"
                  onClick={() => {
                    props.onChangeSaveLocation();
                    setMenuOpen(false);
                  }}
                >
                  <FolderOpen size={14} />
                  <span className="menu__label">Change Save Location…</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/* =====================================================================
 * ActivityBar
 * =================================================================== */

interface ActivityBarProps {
  activeActivity: ActivityId;
  sidebarOpen: boolean;
  onSelectActivity: (activity: ActivityId) => void;
  providerBadge?: number;
  remoteSessionBadge?: number;
  availableActivities?: ActivityId[];
}

export function ActivityBar(props: ActivityBarProps) {
  const allowed = props.availableActivities ?? ACTIVITY_ITEMS.map((item) => item.id);
  const mainItems = ACTIVITY_ITEMS.filter((item) => item.id !== "settings" && allowed.includes(item.id));
  const settingsItem = ACTIVITY_ITEMS.find((item) => item.id === "settings" && allowed.includes(item.id));

  return (
    <nav className="activitybar" aria-label="Activity bar">
      <div className="activitybar__group">
        {mainItems.map((item) => {
          const Icon = ACTIVITY_ICON_MAP[item.id];
          const isActive = props.sidebarOpen && props.activeActivity === item.id;
          let badge: number | undefined;
          if (item.id === "providers") badge = props.providerBadge;
          if (item.id === "sessions") badge = props.remoteSessionBadge;

          return (
            <button
              key={item.id}
              type="button"
              className={`activitybar__button ${isActive ? "activitybar__button--active" : ""}`}
              title={item.description}
              aria-label={item.label}
              onClick={() => props.onSelectActivity(item.id)}
            >
              <Icon size={22} strokeWidth={1.6} />
              {badge ? <span className="activitybar__badge">{badge}</span> : null}
            </button>
          );
        })}
      </div>

      {settingsItem ? (
        <div className="activitybar__group activitybar__group--bottom">
          <button
            type="button"
            className={`activitybar__button ${
              props.sidebarOpen && props.activeActivity === "settings" ? "activitybar__button--active" : ""
            }`}
            title={settingsItem.description}
            aria-label={settingsItem.label}
            onClick={() => props.onSelectActivity("settings")}
          >
            <SettingsIcon size={22} strokeWidth={1.6} />
          </button>
        </div>
      ) : null}
    </nav>
  );
}

/* =====================================================================
 * Sidebar container
 * =================================================================== */

interface SidebarPanelProps {
  title: string;
  headerActions?: ReactNode;
  children: ReactNode;
}

export function SidebarPanel(props: SidebarPanelProps) {
  return (
    <>
      <header className="sidebar__header">
        <h2 className="sidebar__title">{props.title}</h2>
        {props.headerActions ? <div className="sidebar__header-actions">{props.headerActions}</div> : null}
      </header>
      <div className="sidebar__body">{props.children}</div>
    </>
  );
}

/* =====================================================================
 * FilesPanel (workspace tree)
 * =================================================================== */

interface FilesPanelProps {
  workspaceName: string;
  tree: FileTreeNode[];
  activeEntryId: string | null;
  expandedPaths: string[];
  dirtyDocumentIds: Set<string>;
  canPaste: boolean;
  creatingEntry: { kind: "file" | "directory"; parentPath: string | null } | null;
  renamingNodeId: string | null;
  onClearSelection: () => void;
  onSelectEntry: (entryId: string) => void;
  onToggleExpand: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenFilePermanent: (path: string) => void;
  onCreateFile: (parentPath: string | null) => void;
  onCreateFolder: (parentPath: string | null) => void;
  onCommitCreateEntry: (kind: "file" | "directory", parentPath: string | null, name: string) => void;
  onCancelCreateEntry: () => void;
  onCopyEntry: (node: FileTreeNode) => void;
  onPasteEntry: (targetDirectoryPath: string | null) => void;
  onDuplicateEntry: (node: FileTreeNode) => void;
  onRenameEntry: (node: FileTreeNode) => void;
  onCommitRenameEntry: (node: FileTreeNode, name: string) => void;
  onCancelRenameEntry: () => void;
  onDeleteEntry: (node: FileTreeNode) => void;
  onCopyPath: (node: FileTreeNode) => void;
  onCopyRelativePath: (node: FileTreeNode) => void;
  onRevealEntry: (node: FileTreeNode) => void;
  onOpenLocalWorkspace: () => void;
}

export function FilesPanel(props: FilesPanelProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileTreeNode | null;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [contextMenu]);

  const runContextAction = (action: () => void) => {
    action();
    setContextMenu(null);
  };

  const contextNode = contextMenu?.node ?? null;
  const contextDirectoryPath =
    contextNode?.kind === "directory"
      ? contextNode.path
      : contextNode?.parentPath ?? (contextNode?.path.includes("/") ? contextNode.path.slice(0, contextNode.path.lastIndexOf("/")) : null);
  const rootDirectories = props.tree.filter((node) => node.kind === "directory");
  const rootFiles = props.tree.filter((node) => node.kind === "file");
  const rootCreateRow =
    props.creatingEntry?.parentPath === null ? (
      <CreateTreeEntryRow
        kind={props.creatingEntry.kind}
        parentPath={null}
        depth={0}
        onCommit={props.onCommitCreateEntry}
        onCancel={props.onCancelCreateEntry}
      />
    ) : null;
  const renderRootNode = (node: FileTreeNode) => (
    <TreeRow
      key={node.id}
      node={node}
      depth={0}
      activeEntryId={props.activeEntryId}
      expandedPaths={props.expandedPaths}
      dirtyDocumentIds={props.dirtyDocumentIds}
      creatingEntry={props.creatingEntry}
      renamingNodeId={props.renamingNodeId}
      onToggleExpand={props.onToggleExpand}
      onSelectEntry={props.onSelectEntry}
      onOpenFile={props.onOpenFile}
      onOpenFilePermanent={props.onOpenFilePermanent}
      onCommitCreateEntry={props.onCommitCreateEntry}
      onCancelCreateEntry={props.onCancelCreateEntry}
      onCommitRenameEntry={props.onCommitRenameEntry}
      onCancelRenameEntry={props.onCancelRenameEntry}
      onOpenContextMenu={(targetNode, event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onSelectEntry(targetNode.id);
        setContextMenu({ x: event.clientX, y: event.clientY, node: targetNode });
      }}
    />
  );

  return (
    <SidebarPanel
      title={props.workspaceName || "Explorer"}
      headerActions={
        <>
          <button
            type="button"
            className="sidebar__icon-button"
            title="New file"
            onClick={() => props.onCreateFile(null)}
          >
            <FilePlus size={14} />
          </button>
          <button
            type="button"
            className="sidebar__icon-button"
            title="New folder"
            onClick={() => props.onCreateFolder(null)}
          >
            <FolderPlus size={14} />
          </button>
          <button
            type="button"
            className="sidebar__icon-button"
            title="Open folder"
            onClick={props.onOpenLocalWorkspace}
          >
            <FolderOpen size={14} />
          </button>
        </>
      }
    >
      {props.tree.length === 0 ? (
        <div
          className="tree"
          role="tree"
          onMouseDown={() => props.onClearSelection()}
          onContextMenu={(event) => {
            event.preventDefault();
            props.onClearSelection();
            setContextMenu({ x: event.clientX, y: event.clientY, node: null });
          }}
        >
          {rootCreateRow ?? (
            <p className="tree__empty">No files in this workspace.</p>
          )}
        </div>
      ) : (
        <div
          className="tree"
          role="tree"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) props.onClearSelection();
          }}
          onContextMenu={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            props.onClearSelection();
            setContextMenu({ x: event.clientX, y: event.clientY, node: null });
          }}
        >
          {rootCreateRow && props.creatingEntry?.kind === "directory" ? rootCreateRow : null}
          {rootDirectories.map(renderRootNode)}
          {rootCreateRow && props.creatingEntry?.kind === "file" ? rootCreateRow : null}
          {rootFiles.map(renderRootNode)}
        </div>
      )}
      {contextMenu ? (
        <>
          <div className="context-menu-backdrop" onMouseDown={() => setContextMenu(null)} />
          <div className="context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {contextNode?.kind === "file" ? (
              <button type="button" className="menu__item" onClick={() => runContextAction(() => props.onOpenFilePermanent(contextNode.id))}>
                <FileText size={13} />
                <span className="menu__label">Open</span>
              </button>
            ) : null}
            <button type="button" className="menu__item" onClick={() => runContextAction(() => props.onCreateFile(contextDirectoryPath))}>
              <FilePlus size={13} />
              <span className="menu__label">New File</span>
            </button>
            <button type="button" className="menu__item" onClick={() => runContextAction(() => props.onCreateFolder(contextDirectoryPath))}>
              <FolderPlus size={13} />
              <span className="menu__label">New Folder</span>
            </button>
            <button
              type="button"
              className="menu__item"
              disabled={!props.canPaste}
              onClick={() => runContextAction(() => props.onPasteEntry(contextDirectoryPath))}
            >
              <ClipboardPaste size={13} />
              <span className="menu__label">Paste</span>
            </button>
            {contextNode ? (
              <>
                <div className="menu__divider" />
                <button type="button" className="menu__item" onClick={() => runContextAction(() => props.onCopyEntry(contextNode))}>
                  <Copy size={13} />
                  <span className="menu__label">Copy</span>
                </button>
                <button type="button" className="menu__item" onClick={() => runContextAction(() => props.onDuplicateEntry(contextNode))}>
                  <Files size={13} />
                  <span className="menu__label">Duplicate</span>
                </button>
                <button type="button" className="menu__item" onClick={() => runContextAction(() => props.onRenameEntry(contextNode))}>
                  <Pencil size={13} />
                  <span className="menu__label">Rename</span>
                </button>
                <button type="button" className="menu__item menu__item--danger" onClick={() => runContextAction(() => props.onDeleteEntry(contextNode))}>
                  <Trash2 size={13} />
                  <span className="menu__label">Delete</span>
                </button>
                <div className="menu__divider" />
                {contextNode.absolutePath ? (
                  <button type="button" className="menu__item" onClick={() => runContextAction(() => props.onCopyPath(contextNode))}>
                    <Copy size={13} />
                    <span className="menu__label">Copy Path</span>
                  </button>
                ) : null}
                <button type="button" className="menu__item" onClick={() => runContextAction(() => props.onCopyRelativePath(contextNode))}>
                  <Copy size={13} />
                  <span className="menu__label">Copy Relative Path</span>
                </button>
                {window.electronAPI && contextNode.absolutePath ? (
                  <button type="button" className="menu__item" onClick={() => runContextAction(() => props.onRevealEntry(contextNode))}>
                    <ExternalLink size={13} />
                    <span className="menu__label">Reveal in File Explorer</span>
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </SidebarPanel>
  );
}

interface TreeRowProps {
  node: FileTreeNode;
  depth: number;
  activeEntryId: string | null;
  expandedPaths: string[];
  dirtyDocumentIds: Set<string>;
  creatingEntry: { kind: "file" | "directory"; parentPath: string | null } | null;
  renamingNodeId: string | null;
  onToggleExpand: (path: string) => void;
  onSelectEntry: (entryId: string) => void;
  onOpenFile: (path: string) => void;
  onOpenFilePermanent: (path: string) => void;
  onCommitCreateEntry: (kind: "file" | "directory", parentPath: string | null, name: string) => void;
  onCancelCreateEntry: () => void;
  onCommitRenameEntry: (node: FileTreeNode, name: string) => void;
  onCancelRenameEntry: () => void;
  onOpenContextMenu: (node: FileTreeNode, event: ReactMouseEvent<HTMLButtonElement>) => void;
}

interface CreateTreeEntryRowProps {
  kind: "file" | "directory";
  parentPath: string | null;
  depth: number;
  onCommit: (kind: "file" | "directory", parentPath: string | null, name: string) => void;
  onCancel: () => void;
}

function CreateTreeEntryRow(props: CreateTreeEntryRowProps) {
  const placeholder = props.kind === "file" ? "New file" : "New folder";
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);
  const indent = 8 + props.depth * 14 + (props.kind === "file" ? 16 : 0);
  const Icon = props.kind === "file" ? FileType : Folder;

  useEffect(() => {
    committedRef.current = false;
    setValue("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [props.parentPath, props.kind]);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const name = value.trim();
    if (!name) {
      props.onCancel();
      return;
    }
    props.onCommit(props.kind, props.parentPath, name);
  };

  return (
    <div className="tree__row" style={{ paddingLeft: `${indent}px` }}>
      {props.kind === "directory" ? <span className="tree__row-chevron" /> : null}
      <span className="tree__row-icon">
        <Icon size={14} />
      </span>
      <input
        ref={inputRef}
        className="tree__rename-input"
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            committedRef.current = true;
            props.onCancel();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

const TreeRow = memo(TreeRowImpl);

function TreeRowImpl(props: TreeRowProps) {
  const { node, depth } = props;
  const expanded = props.expandedPaths.includes(node.path);
  const indent = 8 + depth * 14;
  const isRenaming = props.renamingNodeId === node.id;
  const isActive = props.activeEntryId === node.id;
  const [renameValue, setRenameValue] = useState(node.name);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCommittedRef = useRef(false);

  useEffect(() => {
    if (!isRenaming) return;
    renameCommittedRef.current = false;
    setRenameValue(node.name);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [isRenaming, node.name]);

  const commitRename = () => {
    if (renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    const nextName = renameValue.trim();
    if (!nextName || nextName === node.name) {
      props.onCancelRenameEntry();
      return;
    }
    props.onCommitRenameEntry(node, nextName);
  };

  if (node.kind === "directory") {
    const childDirectories = (node.children ?? []).filter((child) => child.kind === "directory");
    const childFiles = (node.children ?? []).filter((child) => child.kind === "file");
    const childCreateRow =
      expanded && props.creatingEntry?.parentPath === node.path ? (
        <CreateTreeEntryRow
          kind={props.creatingEntry.kind}
          parentPath={node.path}
          depth={depth + 1}
          onCommit={props.onCommitCreateEntry}
          onCancel={props.onCancelCreateEntry}
        />
      ) : null;
    const renderChild = (child: FileTreeNode) => (
      <TreeRow
        key={child.id}
        node={child}
        depth={depth + 1}
        activeEntryId={props.activeEntryId}
        expandedPaths={props.expandedPaths}
        dirtyDocumentIds={props.dirtyDocumentIds}
        creatingEntry={props.creatingEntry}
        renamingNodeId={props.renamingNodeId}
        onToggleExpand={props.onToggleExpand}
        onSelectEntry={props.onSelectEntry}
        onOpenFile={props.onOpenFile}
        onOpenFilePermanent={props.onOpenFilePermanent}
        onCommitCreateEntry={props.onCommitCreateEntry}
        onCancelCreateEntry={props.onCancelCreateEntry}
        onCommitRenameEntry={props.onCommitRenameEntry}
        onCancelRenameEntry={props.onCancelRenameEntry}
        onOpenContextMenu={props.onOpenContextMenu}
      />
    );

    if (isRenaming) {
      return (
        <div className={`tree__row ${isActive ? "tree__row--active" : ""}`} style={{ paddingLeft: `${indent}px` }}>
          <span className="tree__row-chevron">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="tree__row-icon">
            {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
          </span>
          <input
            ref={renameInputRef}
            className="tree__rename-input"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") {
                renameCommittedRef.current = true;
                props.onCancelRenameEntry();
              }
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      );
    }

    return (
      <>
        <button
          type="button"
          className={`tree__row ${isActive ? "tree__row--active" : ""}`}
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => {
            props.onSelectEntry(node.id);
            props.onToggleExpand(node.path);
          }}
          onContextMenu={(event) => props.onOpenContextMenu(node, event)}
        >
          <span className="tree__row-chevron">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="tree__row-icon">
            {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
          </span>
          <span className="tree__row-label">{node.name}</span>
        </button>
        {expanded && childCreateRow && props.creatingEntry?.kind === "directory" ? childCreateRow : null}
        {expanded ? childDirectories.map(renderChild) : null}
        {expanded && childCreateRow && props.creatingEntry?.kind === "file" ? childCreateRow : null}
        {expanded ? childFiles.map(renderChild) : null}
      </>
    );
  }

  const FileIcon = getFileIcon(node.name);
  const isDirty = props.dirtyDocumentIds.has(node.id);

  if (isRenaming) {
    return (
      <div className={`tree__row ${isActive ? "tree__row--active" : ""}`} style={{ paddingLeft: `${indent + 16}px` }}>
        <span className="tree__row-icon">
          <FileIcon size={14} />
        </span>
        <input
          ref={renameInputRef}
          className="tree__rename-input"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") {
              renameCommittedRef.current = true;
              props.onCancelRenameEntry();
            }
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`tree__row ${isActive ? "tree__row--active" : ""}`}
      style={{ paddingLeft: `${indent + 16}px` }}
      onClick={() => props.onOpenFile(node.id)}
      onDoubleClick={() => props.onOpenFilePermanent(node.id)}
      onContextMenu={(event) => props.onOpenContextMenu(node, event)}
    >
      <span className="tree__row-icon">
        <FileIcon size={14} />
      </span>
      <span className="tree__row-label">{node.name}</span>
      {isDirty ? <span className="tree__dirty-dot" title="Unsaved changes" /> : null}
      {node.unavailable ? <span className="tree__row-meta">missing</span> : null}
    </button>
  );
}

/* =====================================================================
 * SearchPanel
 * =================================================================== */

interface SearchPanelProps {
  query: string;
  results: SearchEntry[];
  onQueryChange: (query: string) => void;
  onSelectResult: (documentId: string) => void;
}

export function SearchPanel(props: SearchPanelProps) {
  return (
    <SidebarPanel title="Search">
      <div className="search-panel">
        <div className="search-input-wrap">
          <span className="search-input-wrap__icon" aria-hidden>
            <SearchIcon size={14} />
          </span>
          <input
            className="search-input"
            type="search"
            placeholder="Search across workspace"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
          />
        </div>
        <div className="search-results">
          {props.results.length > 0 ? (
            props.results.map((result) => (
              <button
                key={`${result.documentId}-${result.indexedAt}`}
                type="button"
                className="search-result"
                onClick={() => props.onSelectResult(result.documentId)}
              >
                <strong>{result.title}</strong>
                <span>{result.path}</span>
                {result.snippet ? <small>{result.snippet}</small> : null}
              </button>
            ))
          ) : props.query ? (
            <p className="search-empty">No matches for "{props.query}".</p>
          ) : (
            <p className="search-empty">Type to search the workspace.</p>
          )}
        </div>
      </div>
    </SidebarPanel>
  );
}

/* =====================================================================
 * SessionsPanel
 * =================================================================== */

interface SessionsPanelProps {
  workspaceName: string;
  manifestHeadRevision: number | undefined;
  manifestUpdatedAt: string | undefined;
  manifestLastWriter: string | undefined;
  bundleStatus: string;
  bundleLocation: string | null;
  workspaceStatus: string;
  pendingRemoteSessionCount: number;
  canCheckRemote: boolean;
  canChangeLocation: boolean;
  onSaveSession: () => void;
  onCheckRemote: () => void;
  onReviewSessions: () => void;
  onChangeSaveLocation: () => void;
  onOpenWorkspaceBundle: () => void;
}

export function SessionsPanel(props: SessionsPanelProps) {
  return (
    <SidebarPanel
      title="Sessions"
      headerActions={
        <button
          type="button"
          className="sidebar__icon-button"
          title="Check for remote session"
          onClick={props.onCheckRemote}
          disabled={!props.canCheckRemote}
        >
          <RefreshCw size={14} />
        </button>
      }
    >
      <div className="panel-list">
        <div className="panel-list__item">
          <p className="panel-list__title">{props.workspaceName || "No workspace"}</p>
          <p className="panel-list__meta">
            {props.manifestHeadRevision !== undefined
              ? "Bundle state available"
              : "No manifest yet"}
          </p>
          {props.manifestUpdatedAt ? (
            <p className="panel-list__meta">
              Updated {new Date(props.manifestUpdatedAt).toLocaleString()}
            </p>
          ) : null}
          {props.manifestLastWriter ? (
            <p className="panel-list__meta">Last writer: {props.manifestLastWriter}</p>
          ) : null}
          <p className="panel-list__meta">{props.bundleStatus}</p>
          {props.bundleLocation ? <p className="panel-list__meta">{props.bundleLocation}</p> : null}
          <p className="panel-list__meta">{props.workspaceStatus}</p>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="panel-action panel-action--primary"
              onClick={props.onSaveSession}
            >
              <Save size={12} />
              Save session
            </button>
            <button type="button" className="panel-action" onClick={props.onOpenWorkspaceBundle}>
              <History size={12} />
              Open bundle
            </button>
            <button
              type="button"
              className="panel-action"
              onClick={props.onReviewSessions}
              disabled={props.pendingRemoteSessionCount === 0}
            >
              <RefreshCw size={12} />
              Review sessions
            </button>
            {props.canChangeLocation ? (
              <button type="button" className="panel-action" onClick={props.onChangeSaveLocation}>
                <FolderOpen size={12} />
                Change location
              </button>
            ) : null}
          </div>
        </div>

        {props.pendingRemoteSessionCount > 0 ? (
          <div className="panel-list__item">
            <p className="panel-list__title" style={{ color: "var(--warning)" }}>
              {props.pendingRemoteSessionCount} remote session{props.pendingRemoteSessionCount === 1 ? "" : "s"} pending
            </p>
            <p className="panel-list__meta">Review and merge remote device sessions from the session picker.</p>
          </div>
        ) : null}
      </div>
    </SidebarPanel>
  );
}

/* =====================================================================
 * ProvidersPanel
 * =================================================================== */

interface ProvidersPanelProps {
  providerStatuses: ProviderStatus[];
}

export function ProvidersPanel(props: ProvidersPanelProps) {
  return (
    <SidebarPanel title="Cloud Providers">
      <div className="panel-list">
        {props.providerStatuses.map((provider) => {
          const statusClass = provider.readiness === "ready"
            ? "provider-row__status provider-row__status--ok"
            : provider.lastError
              ? "provider-row__status provider-row__status--error"
              : "provider-row__status";
          const capabilities = [
            provider.capabilities.auth ? "Auth" : null,
            provider.capabilities.workspaceDiscovery ? "Discovery" : null,
            provider.capabilities.openWorkspace ? "Open" : null,
            provider.capabilities.readFile ? "Read" : null,
            provider.capabilities.writeFile ? "Write" : null,
            provider.capabilities.pollWorkspace ? "Poll" : null,
            provider.capabilities.bundleSync ? "Bundle sync" : null
          ]
            .filter((entry): entry is string => Boolean(entry))
            .join(" • ");

          return (
            <div className="provider-row" key={provider.provider}>
              <Cloud size={16} color="var(--text-muted)" />
              <div className="provider-row__info">
                <p className="provider-row__name">
                  {provider.label}
                  {provider.provider === "local" ? null : (
                    <span className="provider-row__badge">
                      {provider.readiness === "scaffolded" ? "Scaffolded" : provider.readiness === "ready" ? "Ready" : "Planned"}
                    </span>
                  )}
                </p>
                <p className={statusClass}>{provider.lastError ?? provider.statusLabel}</p>
                <p className="provider-row__description">{provider.description}</p>
                <p className="provider-row__capabilities">{capabilities}</p>
              </div>
            </div>
          );
        })}
      </div>
    </SidebarPanel>
  );
}

/* =====================================================================
 * SettingsPanel
 * =================================================================== */

interface SettingsPanelProps {
  themeMode: ThemeMode;
  previewOpen: boolean;
  onThemeModeChange: (mode: ThemeMode) => void;
  onTogglePreview: () => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const themeOptions: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor }
  ];

  return (
    <SidebarPanel title="Settings">
      <div className="settings-group">
        <div className="settings-field">
          <span className="settings-field__label">Theme</span>
          <div className="settings-field__options">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const active = props.themeMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`settings-field__option ${
                    active ? "settings-field__option--active" : ""
                  }`}
                  onClick={() => props.onThemeModeChange(option.value)}
                >
                  <Icon size={12} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="settings-field">
          <span className="settings-field__label">View</span>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={props.previewOpen}
              onChange={props.onTogglePreview}
            />
            Show Markdown preview split
          </label>
        </div>
      </div>
    </SidebarPanel>
  );
}

/* =====================================================================
 * TabStrip
 * =================================================================== */

export interface TabDragIndicator {
  fromGroupId: string;
  documentId: string;
  overGroupId: string | null;
  overTabId: string | null;
  before: boolean;
}

interface TabStripProps {
  groupId: string;
  openTabs: string[];
  activeTabId: string | null;
  previewTabId: string | null;
  tabDrag: TabDragIndicator | null;
  getDocument: (id: string) => { id: string; name: string; dirty: boolean; pendingDraftCount: number } | undefined;
  onActivate: (id: string) => void;
  onPromote: (id: string) => void;
  onClose: (id: string) => void;
  onTabDragStart: (documentId: string) => void;
  onTabDragOver: (overTabId: string | null, before: boolean) => void;
  onTabDrop: (anchorTabId: string | null, before: boolean) => void;
  onTabDragEnd: () => void;
  onSplitRight?: (documentId?: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseToRight: (tabId: string) => void;
  onCloseSaved: () => void;
  onCloseAll: () => void;
  onCopyPath: (tabId: string) => void;
  onCopyRelativePath: (tabId: string) => void;
}

interface TabContextMenu {
  tabId: string;
  x: number;
  y: number;
}

export const TabStrip = memo(TabStripImpl);

function TabStripImpl(props: TabStripProps) {
  const isDragActive = props.tabDrag !== null;
  const isDropTargetGroup = props.tabDrag?.overGroupId === props.groupId;
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [contextMenu]);

  function handleTabDragOver(event: React.DragEvent<HTMLDivElement>, tabId: string) {
    if (!isDragActive) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    props.onTabDragOver(tabId, before);
  }

  function handleStripDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!isDragActive) return;
    const target = event.target as HTMLElement;
    if (target.closest?.(".tab")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    props.onTabDragOver(null, false);
  }

  function handleStripDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!isDragActive) return;
    const target = event.target as HTMLElement;
    if (target.closest?.(".tab")) return;
    event.preventDefault();
    props.onTabDrop(null, false);
  }

  function runAction(action: () => void) {
    action();
    setContextMenu(null);
  }

  const contextTabIndex = contextMenu ? props.openTabs.indexOf(contextMenu.tabId) : -1;
  const isRightmost = contextTabIndex === props.openTabs.length - 1;
  const isPreviewTab = contextMenu ? props.previewTabId === contextMenu.tabId : false;
  const hasSavedTabs = props.openTabs.some((id) => {
    const d = props.getDocument(id);
    return d && !d.dirty;
  });

  return (
    <div
      className={`tab-strip ${isDropTargetGroup ? "tab-strip--drop-target" : ""}`}
      aria-label="Open tabs"
      onDragOver={handleStripDragOver}
      onDrop={handleStripDrop}
    >
      {props.openTabs.map((tabId) => {
        const doc = props.getDocument(tabId);
        if (!doc) return null;
        const Icon = getFileIcon(doc.name);
        const isActive = props.activeTabId === tabId;
        const isPreview = props.previewTabId === tabId;
        const isDragging =
          props.tabDrag?.documentId === tabId && props.tabDrag.fromGroupId === props.groupId;
        const isDropTarget =
          isDropTargetGroup &&
          props.tabDrag?.overTabId === tabId &&
          !(props.tabDrag.fromGroupId === props.groupId && props.tabDrag.documentId === tabId);
        const dropClass = isDropTarget ? (props.tabDrag!.before ? "tab--drop-before" : "tab--drop-after") : "";

        return (
          <div
            key={tabId}
            className={`tab ${isActive ? "tab--active" : ""} ${isPreview ? "tab--preview" : ""} ${isDragging ? "tab--dragging" : ""} ${dropClass}`}
            draggable
            onClick={() => props.onActivate(tabId)}
            onDoubleClick={() => props.onPromote(tabId)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                props.onClose(tabId);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({
                tabId,
                x: Math.min(event.clientX, window.innerWidth - 220),
                y: event.clientY
              });
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", tabId);
              props.onTabDragStart(tabId);
            }}
            onDragOver={(event) => handleTabDragOver(event, tabId)}
            onDrop={(event) => {
              if (!isDragActive) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              const before = event.clientX < rect.left + rect.width / 2;
              props.onTabDrop(tabId, before);
            }}
            onDragEnd={() => props.onTabDragEnd()}
          >
            <Icon size={14} className="tab__icon" />
            <span className="tab__label">{doc.name}</span>
            {doc.pendingDraftCount > 0 ? <span className="tab__badge">{doc.pendingDraftCount}</span> : null}
            {doc.dirty ? <span className="tab__dirty" /> : null}
            <button
              type="button"
              className="tab__close"
              aria-label={`Close ${doc.name}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onClose(tabId);
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
      <div className="tab-strip__spacer" />
      {props.onSplitRight ? (
        <button
          type="button"
          className="tab-strip__action"
          title="Split editor right"
          aria-label="Split editor right"
          onClick={() => props.onSplitRight?.()}
        >
          <Columns2 size={14} />
        </button>
      ) : null}

      {contextMenu ? (
        <>
          <div className="context-menu-backdrop" onMouseDown={() => setContextMenu(null)} />
          <div
            className="context-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button type="button" className="menu__item" onClick={() => runAction(() => props.onClose(contextMenu.tabId))}>
              <span className="menu__label">Close</span>
            </button>
            {isPreviewTab ? (
              <button type="button" className="menu__item" onClick={() => runAction(() => props.onPromote(contextMenu.tabId))}>
                <span className="menu__label">Keep Open</span>
              </button>
            ) : null}
            <div className="menu__divider" />
            <button
              type="button"
              className="menu__item"
              disabled={props.openTabs.length <= 1}
              onClick={() => runAction(() => props.onCloseOthers(contextMenu.tabId))}
            >
              <span className="menu__label">Close Others</span>
            </button>
            <button
              type="button"
              className="menu__item"
              disabled={isRightmost}
              onClick={() => runAction(() => props.onCloseToRight(contextMenu.tabId))}
            >
              <span className="menu__label">Close to the Right</span>
            </button>
            <button
              type="button"
              className="menu__item"
              disabled={!hasSavedTabs}
              onClick={() => runAction(() => props.onCloseSaved())}
            >
              <span className="menu__label">Close Saved</span>
            </button>
            <button type="button" className="menu__item" onClick={() => runAction(() => props.onCloseAll())}>
              <span className="menu__label">Close All</span>
            </button>
            <div className="menu__divider" />
            {window.electronAPI ? (
              <button type="button" className="menu__item" onClick={() => runAction(() => props.onCopyPath(contextMenu.tabId))}>
                <span className="menu__label">Copy Path</span>
              </button>
            ) : null}
            <button type="button" className="menu__item" onClick={() => runAction(() => props.onCopyRelativePath(contextMenu.tabId))}>
              <span className="menu__label">Copy Relative Path</span>
            </button>
            {props.onSplitRight ? (
              <>
                <div className="menu__divider" />
                <button type="button" className="menu__item" onClick={() => runAction(() => props.onSplitRight?.(contextMenu.tabId))}>
                  <span className="menu__label">Split Right</span>
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* =====================================================================
 * StatusBar
 * =================================================================== */

interface StatusBarProps {
  activePath: string | null;
  language: string | null;
  dirty: boolean;
  pendingDraftCount: number;
  cursorLine: number | null;
  cursorColumn: number | null;
  themeMode: ThemeMode;
  statusMessage: string;
  onCycleTheme: () => void;
}

export function StatusBar(props: StatusBarProps) {
  const ThemeIcon =
    props.themeMode === "dark" ? Moon : props.themeMode === "light" ? Sun : Monitor;

  return (
    <footer className="statusbar" role="status">
      <div className="statusbar__group">
        {props.activePath ? (
          <span className="statusbar__item statusbar__item--path" title={props.activePath}>
            {props.activePath}
          </span>
        ) : (
          <span className="statusbar__item">{props.statusMessage || "Ready"}</span>
        )}
      </div>

      <div className="statusbar__group statusbar__group--right">
        {props.cursorLine !== null && props.cursorColumn !== null ? (
          <span className="statusbar__item">
            Ln {props.cursorLine}, Col {props.cursorColumn + 1}
          </span>
        ) : null}
        {props.language ? <span className="statusbar__item">{props.language}</span> : null}
        {props.activePath && props.pendingDraftCount > 0 ? (
          <span className="statusbar__item statusbar__item--warning">
            {props.pendingDraftCount} remote draft{props.pendingDraftCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {props.activePath ? (
          <span className={`statusbar__item ${props.dirty ? "statusbar__item--dirty" : ""}`}>
            {props.dirty ? (
              <>
                <Circle size={8} fill="currentColor" />
                Unsaved
              </>
            ) : (
              <>
                <Check size={12} />
                Saved
              </>
            )}
          </span>
        ) : null}
        <button
          type="button"
          className="statusbar__item statusbar__item--interactive"
          onClick={props.onCycleTheme}
          title={`Theme: ${props.themeMode}`}
        >
          <ThemeIcon size={12} />
          {props.themeMode}
        </button>
      </div>
    </footer>
  );
}

/* =====================================================================
 * Modals: SessionPickerDialog
 * =================================================================== */

interface SessionPickerDialogProps {
  sessions: Array<{
    revisionId: string;
    deviceName: string;
    updatedAt: string;
    openTabCount: number;
    activeTab: string | null;
  }>;
  selectedRevisionId: string | null;
  onSelect: (revisionId: string) => void;
  onResumeRemote: () => void;
  onCompare: () => void;
  onDismiss: () => void;
  onClose: () => void;
}

export function SessionPickerDialog(props: SessionPickerDialogProps) {
  const selectedSession =
    props.sessions.find((session) => session.revisionId === props.selectedRevisionId) ?? props.sessions[0] ?? null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal modal--wide">
        <div className="modal__header">
          <h2>Remote sessions</h2>
          <p>Pick a device session to compare, resume, or dismiss. Apply them one at a time in any order.</p>
        </div>
        <div className="session-picker">
          <div className="session-picker__list">
            {props.sessions.map((session) => {
              const isSelected = session.revisionId === selectedSession?.revisionId;
              return (
                <button
                  key={session.revisionId}
                  type="button"
                  className={`session-picker__row ${isSelected ? "session-picker__row--selected" : ""}`}
                  onClick={() => props.onSelect(session.revisionId)}
                >
                  <strong>{session.deviceName}</strong>
                  <span>{new Date(session.updatedAt).toLocaleString()}</span>
                  <small>
                    {session.openTabCount} open tab{session.openTabCount === 1 ? "" : "s"}
                    {session.activeTab ? ` • ${session.activeTab}` : ""}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="session-picker__details">
            {selectedSession ? (
              <>
                <strong>{selectedSession.deviceName}</strong>
                <p>Saved {new Date(selectedSession.updatedAt).toLocaleString()}</p>
                <p>
                  {selectedSession.openTabCount} open tab{selectedSession.openTabCount === 1 ? "" : "s"}
                  {selectedSession.activeTab ? ` with ${selectedSession.activeTab} active.` : "."}
                </p>
              </>
            ) : (
              <p>No pending remote sessions.</p>
            )}
          </div>
        </div>
        <div className="modal__actions">
          <button type="button" className="button--ghost button" onClick={props.onClose}>
            Close
          </button>
          <button type="button" className="button--ghost button" onClick={props.onDismiss} disabled={!selectedSession}>
            Dismiss
          </button>
          <button type="button" className="button--ghost button" onClick={props.onCompare} disabled={!selectedSession}>
            Compare
          </button>
          <button type="button" className="button" onClick={props.onResumeRemote} disabled={!selectedSession}>
            Resume remote
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
 * Modals: SessionCompareDialog
 * =================================================================== */

interface SessionCompareDialogProps {
  items: SessionCompareItem[];
  onChangeSelection: (id: string, nextSelection: "local" | "remote") => void;
  onUseAll: (selection: "local" | "remote") => void;
  onApply: () => void;
  onCancel: () => void;
}

export function SessionCompareDialog(props: SessionCompareDialogProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal modal--wide">
        <div className="modal__header">
          <h2>Compare sessions</h2>
          <p>Choose the state you want for each section, or bulk-apply one side.</p>
        </div>
        <div className="modal__bulk-actions">
          <button type="button" className="button button--ghost" onClick={() => props.onUseAll("local")}>
            Use all local
          </button>
          <button type="button" className="button button--ghost" onClick={() => props.onUseAll("remote")}>
            Use all remote
          </button>
        </div>
        <div className="compare-grid">
          {props.items.map((item) => (
            <div className="compare-row" key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <small>{renderCompareValue(item.localValue)}</small>
              </div>
              <div className="compare-row__controls">
                <label>
                  <input
                    type="radio"
                    checked={item.selection === "local"}
                    onChange={() => props.onChangeSelection(item.id, "local")}
                  />
                  Local
                </label>
                <label>
                  <input
                    type="radio"
                    checked={item.selection === "remote"}
                    onChange={() => props.onChangeSelection(item.id, "remote")}
                  />
                  Remote
                </label>
              </div>
              <div>
                <small>{renderCompareValue(item.remoteValue)}</small>
              </div>
            </div>
          ))}
        </div>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" className="button" onClick={props.onApply}>
            Apply selection
          </button>
        </div>
      </div>
    </div>
  );
}

function renderCompareValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ") || "None";
  }

  if (typeof value === "object" && value) {
    return JSON.stringify(value);
  }

  return String(value ?? "None");
}

/* =====================================================================
 * Modals: ForeignDraftDialog
 * =================================================================== */

interface ForeignDraftDialogProps {
  documentName: string;
  remoteUpdatedAt: string;
  remoteDeviceName: string;
  onOpenDraft: () => void;
  onCompare: () => void;
  onDismiss: () => void;
}

export function ForeignDraftDialog(props: ForeignDraftDialogProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal">
        <div className="modal__simple-body">
          <h2>Draft available</h2>
          <p>
            <strong>{props.documentName}</strong> has an unsaved draft from{" "}
            <strong>{props.remoteDeviceName}</strong> saved at{" "}
            <strong>{new Date(props.remoteUpdatedAt).toLocaleString()}</strong>.
          </p>
        </div>
        <div className="modal__actions">
          <button type="button" className="button--ghost button" onClick={props.onDismiss}>
            Dismiss
          </button>
          <button type="button" className="button--ghost button" onClick={props.onCompare}>
            Compare
          </button>
          <button type="button" className="button" onClick={props.onOpenDraft}>
            Open draft
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
 * Modals: WorkspaceFileConflictDialog
 * =================================================================== */

interface WorkspaceFileConflictDialogProps {
  documentName: string;
  deleted: boolean;
  localBody: string;
  remoteBody: string;
  onKeepLocal: () => void;
  onUseDisk: () => void;
  onSaveCopy: () => void;
}

interface ConfirmationDialogProps {
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog(props: ConfirmationDialogProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal">
        <div className="modal__simple-body">
          <p>{props.message}</p>
        </div>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`button ${props.destructive ? "button--danger" : ""}`}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SaveWorkspacePromptDialogProps {
  workspaceName: string;
  saving: boolean;
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

interface SaveDocumentPromptDialogProps {
  documentName: string;
  saving: boolean;
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

/**
 * Renders the close-tab prompt for a dirty document.
 *
 * @param props - The document name, pending state, and prompt action handlers.
 * @returns Modal JSX for saving, discarding, or cancelling the tab close.
 */
export function SaveDocumentPromptDialog(props: SaveDocumentPromptDialogProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal">
        <div className="modal__simple-body">
          <p>Save changes to {props.documentName} before closing?</p>
        </div>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={props.onCancel} disabled={props.saving}>
            Cancel
          </button>
          <button type="button" className="button button--ghost" onClick={props.onDontSave} disabled={props.saving}>
            Don't Save
          </button>
          <button type="button" className="button" onClick={props.onSave} disabled={props.saving}>
            {props.saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the desktop close prompt for unsaved workspace bundle state.
 *
 * @param props - The workspace name, pending state, and prompt action handlers.
 * @returns Modal JSX for saving, discarding, or cancelling the window close.
 */
export function SaveWorkspacePromptDialog(props: SaveWorkspacePromptDialogProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal">
        <div className="modal__simple-body">
          <p>Save workspace changes for {props.workspaceName} before closing?</p>
        </div>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={props.onCancel} disabled={props.saving}>
            Cancel
          </button>
          <button type="button" className="button button--ghost" onClick={props.onDontSave} disabled={props.saving}>
            Don't Save
          </button>
          <button type="button" className="button" onClick={props.onSave} disabled={props.saving}>
            {props.saving ? "Saving..." : "Save Workspace"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface MessageDialogProps {
  message: string;
  onClose: () => void;
}

export function MessageDialog(props: MessageDialogProps) {
  const okButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    okButtonRef.current?.focus();
  }, []);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal">
        <div className="modal__simple-body">
          <p>{props.message}</p>
        </div>
        <div className="modal__actions">
          <button ref={okButtonRef} type="button" className="button" onClick={props.onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceFileConflictDialog(props: WorkspaceFileConflictDialogProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal modal--wide">
        <div className="modal__header">
          <h2 style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <AlertCircle size={15} color="var(--warning)" />
            File changed on disk
          </h2>
          <p>
            <strong>{props.documentName}</strong>{" "}
            {props.deleted
              ? "was removed outside the editor while you still had local changes."
              : "changed outside the editor while you still had local changes."}
          </p>
        </div>
        <div className="diff-grid">
          <div>
            <h3>Local changes</h3>
            <pre>{props.localBody}</pre>
          </div>
          <div>
            <h3>{props.deleted ? "Disk state (deleted)" : "Disk version"}</h3>
            <pre>{props.deleted ? "(file deleted)" : props.remoteBody}</pre>
          </div>
        </div>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={props.onSaveCopy}>
            Save copy
          </button>
          <button type="button" className="button button--ghost" onClick={props.onUseDisk}>
            Use disk
          </button>
          <button type="button" className="button" onClick={props.onKeepLocal}>
            Keep local
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
 * WorkspaceScanOverlay
 * =================================================================== */

interface WorkspaceScanOverlayProps {
  progress: WorkspaceScanProgress;
  onCancel: () => void;
  onSkipFolder: (folderPath: string) => void;
}

export function WorkspaceScanOverlay(props: WorkspaceScanOverlayProps) {
  const { entriesProcessed, filesLoaded, currentPath, cancelRequested, skipFolderName, skipFolderPath } =
    props.progress;
  const headline = cancelRequested
    ? "Stopping workspace scan…"
    : entriesProcessed > 0
      ? "Scanning workspace…"
      : "Opening workspace…";

  return (
    <div className="scan-overlay" role="dialog" aria-modal="true" aria-label="Workspace scan">
      <div className="scan-overlay__card">
        <div className="scan-overlay__spinner" aria-hidden />
        <div className="scan-overlay__headline">{headline}</div>
        <div className="scan-overlay__stats">
          <span>
            <strong>{entriesProcessed.toLocaleString()}</strong> entries scanned
          </span>
          <span className="scan-overlay__stats-separator">·</span>
          <span>
            <strong>{filesLoaded.toLocaleString()}</strong> files loaded
          </span>
        </div>
        <div
          className="scan-overlay__path"
          title={currentPath || undefined}
          aria-hidden={!currentPath}
        >
          {currentPath || "Preparing to read folder…"}
        </div>
        <div className="scan-overlay__hint">
          {cancelRequested
            ? "The app will open the files that were already scanned."
            : "Large folders (for example, `node_modules` or OneDrive-synced trees) can take a while."}
        </div>
        <div className="scan-overlay__actions">
          {skipFolderPath && skipFolderName ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => props.onSkipFolder(skipFolderPath)}
              disabled={cancelRequested}
            >
              {`Skip ${skipFolderName} folder`}
            </button>
          ) : null}
          <button
            type="button"
            className="button button--ghost"
            onClick={props.onCancel}
            disabled={cancelRequested}
          >
            {cancelRequested ? "Cancelling…" : "Cancel scan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
 * WorkspaceErrorBanner
 * =================================================================== */

interface WorkspaceErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function WorkspaceErrorBanner(props: WorkspaceErrorBannerProps) {
  return (
    <div className="workspace-error-banner" role="alert">
      <AlertCircle size={16} aria-hidden />
      <div className="workspace-error-banner__message">{props.message}</div>
      <button
        type="button"
        className="workspace-error-banner__dismiss"
        onClick={props.onDismiss}
        aria-label="Dismiss error"
      >
        <X size={14} />
      </button>
    </div>
  );
}
