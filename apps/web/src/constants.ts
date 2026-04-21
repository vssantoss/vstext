import {
  MANIFEST_DIR_NAME,
  MANIFEST_FILE_NAME,
  SUPPORTED_BINARY_EXTENSIONS,
  SUPPORTED_TEXT_EXTENSIONS
} from "../../../packages/core/index.js";
import type { ActivityId, ProviderId } from "./types";

export {
  MANIFEST_DIR_NAME,
  MANIFEST_FILE_NAME,
  SUPPORTED_BINARY_EXTENSIONS,
  SUPPORTED_TEXT_EXTENSIONS
};

export const APP_NAME = "VS Text";
export const APP_SLUG = "vstext";
export const DATABASE_NAME = "vstext-db";
export const DEVICE_ID_STORAGE_KEY = "vstext-device-id";
export const BUNDLE_DIRECTORY_SUFFIX = "-vstext";
export const MAX_FULL_FEATURE_FILE_SIZE = 2 * 1024 * 1024;
export const MAX_HIGHLIGHT_FILE_SIZE = 10 * 1024 * 1024;

export const CLOUD_PROVIDER_LABELS: Record<Exclude<ProviderId, "local">, string> = {
  onedrive: "OneDrive",
  gdrive: "Google Drive",
  dropbox: "Dropbox"
};

export const ACTIVITY_ITEMS: { id: ActivityId; label: string; description: string }[] = [
  { id: "files", label: "Explorer", description: "Workspace files" },
  { id: "search", label: "Search", description: "Find across files" },
  { id: "sessions", label: "Sessions", description: "Workspace sessions" },
  { id: "providers", label: "Cloud", description: "Cloud providers" },
  { id: "settings", label: "Settings", description: "Preferences" }
];
