/**
 * Terminal rendering helpers for REPL output.
 *
 * We keep command output as plain wrapped text, and render assistant replies as
 * markdown so lists, code fences, and emphasis read more naturally in the
 * terminal. This uses `marked` + `marked-terminal`.
 */
import { Marked } from "marked";
import chalk from "chalk";
import { markedTerminal } from "marked-terminal";

/**
 * Normalizes accidentally indented list items so the terminal markdown parser
 * treats them as lists rather than indented code blocks.
 */
const normalizeIndentedLists = (text: string): string => {
  return text
    .split("\n")
    .map((line) => {
      const match = /^( {4,})([*+-]|\d+\.)\s+/u.exec(line);
      if (!match) {
        return line;
      }

      const indent = match[1] ?? "";
      const marker = match[2] ?? "";
      const normalizedIndent = " ".repeat(Math.max(0, indent.length - 4));
      return `${normalizedIndent}${line.slice(indent.length).replace(/^([*+-]|\d+\.)\s+/u, `${marker} `)}`;
    })
    .join("\n");
};

const formatRenderedListLine = (line: string): string => {
  if (!/^\s*(?:[*+-]|\d+\.)\s+/u.test(line)) {
    return line;
  }

  return line
    .replace(/\*\*(.+?)\*\*/gu, (_match, content: string) => chalk.green.bold(content))
    .replace(/`(.+?)`/gu, (_match, content: string) => chalk.green(content));
};

const createMarkdownRenderer = (width: number): Marked =>
  new Marked(
    markedTerminal({
      reflowText: width > 0,
      width: width > 0 ? width : 80,
      showSectionPrefix: false,
      heading: chalk.green.bold,
      firstHeading: chalk.green.bold,
      codespan: chalk.green,
      strong: chalk.green.bold,
    } as Record<string, unknown>),
  );

export const renderMarkdownForTerminal = (
  text: string,
  width: number,
): string => {
  const renderer = createMarkdownRenderer(width);
  const rendered = renderer.parse(normalizeIndentedLists(text));
  if (typeof rendered !== "string") {
    return text;
  }

  return rendered
    .split("\n")
    .map(formatRenderedListLine)
    .join("\n")
    .trimEnd();
};
