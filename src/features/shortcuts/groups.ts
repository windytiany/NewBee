import type { ShortcutAction } from "@/features/shortcuts/bindings";

type ShortcutGroup = {
  id: string;
  label: string;
  actions: readonly ShortcutAction[];
  keys?: readonly (readonly [string, string])[];
};

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: "playback",
    label: "播放控制",
    actions: [
      "togglePlayback",
      "previous",
      "next",
      "seekBackward",
      "seekForward",
      "toggleShuffle",
      "toggleRepeat",
    ],
  },
  {
    id: "volume",
    label: "音量",
    actions: ["volumeDown", "volumeUp", "toggleMute"],
  },
  {
    id: "pages",
    label: "页面导航",
    actions: ["showPlaying", "showLibrary", "showPlaylist", "showInbox"],
  },
  { id: "queue", label: "队列", actions: ["addToQueue"] },
  { id: "window", label: "窗口", actions: ["toggleWindow"] },
  {
    id: "application",
    label: "应用操作",
    actions: ["showCommands", "showShortcuts", "showSettings"],
  },
  {
    id: "focus",
    label: "焦点导航",
    actions: [],
    keys: [
      ["Tab / Shift + Tab", "切换控件"],
      ["F6 / Shift + F6", "切换区域"],
    ],
  },
  {
    id: "selection",
    label: "列表操作",
    actions: [],
    keys: [
      ["↑ / ↓ / ← / →", "移动选择"],
      ["Shift + ↑ / ↓", "扩展选择"],
      ["Ctrl + ↑ / ↓", "移动焦点"],
      ["Ctrl + Space", "切换选中"],
      ["Home / End", "首项/末项"],
      ["Ctrl + A", "全选"],
      ["Enter", "打开/播放"],
    ],
  },
  {
    id: "menus",
    label: "菜单与弹窗",
    actions: [],
    keys: [
      ["Shift + F10", "打开菜单"],
      ["Escape", "关闭"],
    ],
  },
];

export const BINDING_GROUPS = SHORTCUT_GROUPS.filter((group) => group.actions.length > 0);
