import {
  ActionPanel,
  Action,
  List,
  showToast,
  Toast,
  Icon,
} from "@raycast/api";
import { useState, useEffect, useMemo } from "react";
import fs from "fs/promises";
import path from "path";
import os from "os";

type BrowserType = "chrome" | "edge";

interface BrowserConfig {
  name: string;
  icon: string;
  macPathPrefix: string[];
  winPathCandidates: string[][];
}

const BROWSERS: Record<BrowserType, BrowserConfig> = {
  chrome: {
    name: "Google Chrome",
    icon: "chrome.png",
    macPathPrefix: ["Google", "Chrome"],
    winPathCandidates: [["Google", "Chrome", "User Data"]],
  },
  edge: {
    name: "Microsoft Edge",
    icon: "edge.png",
    macPathPrefix: ["Microsoft Edge"],
    winPathCandidates: [["Microsoft", "Edge", "User Data"]],
  },
};

interface BookmarkNode {
  id: string;
  name: string;
  type: string;
  url?: string;
  children?: BookmarkNode[];
}

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  path: string;
  source: string;
  browser: BrowserType;
  browserName: string;
}

const PROFILES_TO_CHECK = ["Default", "Profile 1", "Profile 2", "Profile 3"];

/** Truncate a URL for display, keeping domain + partial path */
function truncateUrl(url: string, max = 60): string {
  try {
    const u = new URL(url);
    const display = u.hostname + u.pathname;
    return display.length > max ? display.slice(0, max) + "…" : display;
  } catch {
    return url.length > max ? url.slice(0, max) + "…" : url;
  }
}

/** Load bookmarks for a single browser */
async function loadBrowserBookmarks(browserType: BrowserType): Promise<BookmarkItem[]> {
  const browserConfig = BROWSERS[browserType];
  const homeDir = os.homedir();
  const isMac = process.platform === "darwin";

  const candidateBasePaths: string[] = [];

  if (isMac) {
    candidateBasePaths.push(
      path.join(homeDir, "Library", "Application Support", ...browserConfig.macPathPrefix),
    );
  } else {
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    browserConfig.winPathCandidates.forEach((segments) => {
      candidateBasePaths.push(path.join(localAppData, ...segments));
    });
  }

  const allItems: BookmarkItem[] = [];

  // Check ALL profiles, not just the first match
  for (const basePath of candidateBasePaths) {
    for (const profile of PROFILES_TO_CHECK) {
      const checkPath = path.join(basePath, profile, "Bookmarks");
      try {
        await fs.access(checkPath);
      } catch {
        continue;
      }

      try {
        const data = await fs.readFile(checkPath, "utf-8");
        const json = JSON.parse(data);
        const items: BookmarkItem[] = [];

        const roots = [json.roots?.bookmark_bar, json.roots?.other, json.roots?.synced].filter(Boolean);

        const traverse = (node: BookmarkNode, folderPath: string) => {
          if (node.type === "url" && node.url) {
            items.push({
              id: node.id,
              title: node.name,
              url: node.url,
              path: folderPath,
              source: profile,
              browser: browserType,
              browserName: browserConfig.name,
            });
          } else if (node.children) {
            const newPath = folderPath ? `${folderPath} / ${node.name}` : node.name;
            node.children.forEach((child) => traverse(child, newPath));
          }
        };

        roots.forEach((root) => traverse(root, ""));
        allItems.push(...items);
      } catch {
        // skip unreadable profiles
      }
    }
  }

  return allItems;
}

const PREFS_FILE = path.join(os.homedir(), ".raycast-bookmarks-prefs.json");

function readSavedBrowser(): string {
  try {
    const data = require("fs").readFileSync(PREFS_FILE, "utf-8");
    return JSON.parse(data).defaultBrowser || "all";
  } catch {
    return "all";
  }
}

function saveBrowser(value: string) {
  try {
    require("fs").writeFileSync(PREFS_FILE, JSON.stringify({ defaultBrowser: value }));
  } catch {
    // ignore
  }
}

export default function Command() {
  const savedBrowser = readSavedBrowser();
  const [allBookmarks, setAllBookmarks] = useState<BookmarkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>(savedBrowser);
  const [error, setError] = useState<string | null>(null);
  const [permissionIssue, setPermissionIssue] = useState(false);
  const [availableBrowsers, setAvailableBrowsers] = useState<BrowserType[] | null>(null);

  function onFilterChange(value: string) {
    setFilter(value);
    saveBrowser(value);
  }

  useEffect(() => {
    async function fetchAll() {
      setIsLoading(true);
      setError(null);
      setPermissionIssue(false);

      const allItems: BookmarkItem[] = [];
      const found: BrowserType[] = [];

      for (const browserType of Object.keys(BROWSERS) as BrowserType[]) {
        try {
          const items = await loadBrowserBookmarks(browserType);
          if (items.length > 0) {
            allItems.push(...items);
            found.push(browserType);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (msg.includes("EPERM") || msg.includes("EACCES") || msg.includes("Operation not permitted")) {
            setPermissionIssue(true);
          }
        }
      }

      if (allItems.length === 0 && !permissionIssue) {
        setError("No bookmarks found in any browser. Check that Chrome or Edge is installed.");
      }

      setAllBookmarks(allItems);
      setAvailableBrowsers(found); // triggers Dropdown to render
      setIsLoading(false);
    }

    fetchAll();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return allBookmarks;
    return allBookmarks.filter((b) => b.browser === filter);
  }, [allBookmarks, filter]);

  if (permissionIssue) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Warning}
          title="Permission Denied"
          description="Go to System Settings -> Privacy & Security -> Full Disk Access -> Enable Raycast."
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search bookmarks..."
      searchBarAccessory={
        availableBrowsers !== null ? (
          <List.Dropdown tooltip="Filter Browser" onChange={onFilterChange} value={filter}>
            <List.Dropdown.Item title="All Browsers" value="all" icon={Icon.Globe} />
            <List.Dropdown.Section>
              {availableBrowsers.map((key) => (
                <List.Dropdown.Item
                  key={key}
                  title={BROWSERS[key].name}
                  value={key}
                  icon={BROWSERS[key].icon}
                />
              ))}
            </List.Dropdown.Section>
          </List.Dropdown>
        ) : undefined
      }
    >
      {error && !isLoading ? (
        <List.EmptyView icon={Icon.Warning} title="Unable to read bookmarks" description={error} />
      ) : filtered.length === 0 && !isLoading ? (
        <List.EmptyView icon={Icon.Bookmark} title="No bookmarks found" />
      ) : (
        filtered.map((item) => (
          <List.Item
            key={`${item.browser}-${item.source}-${item.id}`}
            icon={BROWSERS[item.browser].icon}
            title={item.title}
            subtitle={item.path}
            accessories={[
              { text: truncateUrl(item.url), tooltip: item.url },
            ]}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser url={item.url} />
                <Action.CopyToClipboard content={item.url} title="Copy URL" />
                <Action.CopyToClipboard
                  content={item.title}
                  title="Copy Title"
                  shortcut={{ modifiers: ["cmd"], key: "." }}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
