import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  createSourceFile,
  forEachChild,
  isCallExpression,
  isStringLiteral,
  ScriptTarget,
  type Node,
} from "typescript";
import { compileSfc } from "../../support/module/loader";
import { libraryMessages } from "@/shared/i18n/messages/library";
import { metadataMessages } from "@/shared/i18n/messages/metadata";
import { playbackMessages } from "@/shared/i18n/messages/playback";
import { settingsMessages } from "@/shared/i18n/messages/settings";
import { interfaceMessages } from "@/shared/i18n/messages/interface";
import { inboxMessages } from "@/shared/i18n/messages/inbox";
import { remappingMessages } from "@/shared/i18n/messages/remapping";

const messages = {
  ...libraryMessages,
  ...metadataMessages,
  ...playbackMessages,
  ...settingsMessages,
  ...interfaceMessages,
  ...inboxMessages,
  ...remappingMessages,
};
const sourceRoot = new URL("../../../src/", import.meta.url);

function sourceFiles(directory = ""): string[] {
  return readdirSync(new URL(directory, sourceRoot), { withFileTypes: true }).flatMap((entry) => {
    const filename = `${directory}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(`${filename}/`);
    return /\.(ts|vue)$/.test(filename) ? [filename] : [];
  });
}

test("every literal interface message has an English translation", () => {
  const missing: string[] = [];
  for (const filename of sourceFiles().filter((file) => !file.startsWith("shared/i18n/"))) {
    const source = readFileSync(new URL(filename, sourceRoot), "utf8");
    const compiled = filename.endsWith(".vue") ? compileSfc(source, filename) : source;
    const tree = createSourceFile(filename, compiled, ScriptTarget.Latest, true);
    function visit(node: Node) {
      if (isCallExpression(node) && /\bt\b/.test(node.expression.getText(tree))) {
        const message = node.arguments[0];
        if (
          message &&
          isStringLiteral(message) &&
          /\p{Script=Han}/u.test(message.text) &&
          !Object.prototype.hasOwnProperty.call(messages, message.text)
        ) {
          missing.push(`${filename}: ${message.text}`);
        }
      }
      forEachChild(node, visit);
    }
    visit(tree);
  }
  expect(missing).toEqual([]);
});
