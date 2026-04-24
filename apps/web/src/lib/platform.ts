export type RuntimePlatform = "windows" | "mac" | "linux" | "unknown";

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

export function detectRuntimePlatform(platformSource?: string): RuntimePlatform {
  const source =
    platformSource ??
    (typeof navigator === "undefined"
      ? ""
      : ((navigator as NavigatorWithUserAgentData).userAgentData?.platform ?? navigator.platform ?? ""));

  if (/win/i.test(source)) {
    return "windows";
  }

  if (/mac|darwin/i.test(source)) {
    return "mac";
  }

  if (/linux/i.test(source)) {
    return "linux";
  }

  return "unknown";
}

export function formatAbsolutePathForClipboard(path: string, platform = detectRuntimePlatform()) {
  if (platform !== "windows") {
    return path;
  }

  if (/^[a-z]:\//i.test(path) || path.startsWith("//")) {
    return path.replaceAll("/", "\\");
  }

  return path;
}
