import { ActionPanel, Action, List, showToast, Toast } from "@raycast/api";
import { useState, useEffect } from "react";
import fs from "fs/promises";
import path from "path";
import os from "os";

// 定義瀏覽器路徑設定
const BROWSERS: Record<string, { name: string; paths: string[] }> = {
    chrome: {
        name: "Google Chrome",
        paths: ["Google", "Chrome", "User Data", "Default", "Bookmarks"],
    },
    edge: {
        name: "Microsoft Edge",
        paths: ["Microsoft", "Edge", "User Data", "Default", "Bookmarks"],
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
}

export default function Command() {
    const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedBrowser, setSelectedBrowser] = useState<string>("chrome"); // 預設選 Chrome

    useEffect(() => {
        async function fetchBookmarks() {
            setIsLoading(true);
            setBookmarks([]); // 切換時先清空列表

            try {
                const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

                // 根據選擇的瀏覽器組合路徑
                const browserConfig = BROWSERS[selectedBrowser];
                const bookmarkPath = path.join(localAppData, ...browserConfig.paths);

                const data = await fs.readFile(bookmarkPath, "utf-8");
                const json = JSON.parse(data);
                const items: BookmarkItem[] = [];

                const roots = [
                    json.roots.bookmark_bar,
                    json.roots.other,
                    json.roots.synced
                ].filter(Boolean);

                const traverse = (node: BookmarkNode, folderPath: string) => {
                    if (node.type === "url" && node.url) {
                        items.push({
                            id: node.id,
                            title: node.name,
                            url: node.url,
                            path: folderPath
                        });
                    } else if (node.children) {
                        const newPath = folderPath ? `${folderPath} > ${node.name}` : node.name;
                        node.children.forEach(child => traverse(child, newPath));
                    }
                };

                roots.forEach(root => traverse(root, ""));
                setBookmarks(items);
                setIsLoading(false);
            } catch (error) {
                console.error(error);
                showToast({
                    style: Toast.Style.Failure,
                    title: "讀取失敗",
                    message: `找不到 ${BROWSERS[selectedBrowser].name} 的書籤檔案`,
                });
                setIsLoading(false);
            }
        }

        fetchBookmarks();
    }, [selectedBrowser]); // 當 selectedBrowser 改變時重新執行

    return (
        <List
            isLoading={isLoading}
            searchBarPlaceholder={`Search ${BROWSERS[selectedBrowser].name} bookmarks...`}
            searchBarAccessory={
                <List.Dropdown
                    tooltip="Select Browser"
                    storeValue={true} // 記住上次的選擇
                    onChange={(newValue) => setSelectedBrowser(newValue)}
                >
                    <List.Dropdown.Item title="Google Chrome" value="chrome" />
                    <List.Dropdown.Item title="Microsoft Edge" value="edge" />
                </List.Dropdown>
            }
        >
            {bookmarks.map((item) => (
                <List.Item
                    key={item.id}
                    title={item.title}
                    subtitle={item.url}
                    accessories={[{ text: item.path }]}
                    actions={
                        <ActionPanel>
                            <Action.OpenInBrowser url={item.url} />
                            <Action.CopyToClipboard content={item.url} title="Copy URL" />
                        </ActionPanel>
                    }
                />
            ))}
        </List>
    );
}