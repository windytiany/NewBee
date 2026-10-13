import { locale } from "@/shared/i18n/locale";
import { metadataMessages } from "@/shared/i18n/messages/metadata";

const labels = [
  "其他图片",
  "文件图标",
  "其他文件图标",
  "正面封面",
  "背面封面",
  "内页",
  "介质",
  "主艺术家",
  "艺术家",
  "指挥",
  "乐队",
  "作曲家",
  "作词者",
  "录音地点",
  "录音期间",
  "演出期间",
  "视频截图",
  "鲜艳的鱼",
  "插画",
  "艺术家标志",
  "出版商标志",
] as const;
const japanese = [
  "その他",
  "ファイルアイコン",
  "その他のファイルアイコン",
  "表紙",
  "裏表紙",
  "ライナーノーツ",
  "メディア",
  "リードアーティスト",
  "アーティスト",
  "指揮者",
  "バンド",
  "作曲者",
  "作詞者",
  "録音場所",
  "録音中",
  "演奏中",
  "ビデオキャプチャ",
  "鮮やかな魚",
  "イラスト",
  "アーティストのロゴ",
  "出版社のロゴ",
] as const;
export const pictureTypes = labels.map((_, value) => value);
export function pictureTypeLabel(
  value: number,
  language: "zh-CN" | "en" | "ja" = locale.value,
): string {
  if (language === "ja") return japanese[value] ?? `種類 ${value}`;
  const label = labels[value];
  if (!label) return language === "en" ? `Type ${value}` : `类型 ${value}`;
  return language === "en" ? (metadataMessages[label] ?? label) : label;
}
