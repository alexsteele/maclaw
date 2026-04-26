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

const ANSI_PATTERN = /\u001B\[[0-9;]*m/gu;

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

const visibleLength = (value: string): number =>
  value.replace(ANSI_PATTERN, "").length;

const wrapRenderedListLine = (line: string, width: number): string => {
  if (width <= 0 || visibleLength(line) <= width) {
    return line;
  }

  const bulletMatch = /^(\s*)((?:[*+-]|\d+\.))\s+(.*)$/u.exec(line);
  if (!bulletMatch) {
    return line;
  }

  const baseIndent = `${bulletMatch[1] ?? ""}${bulletMatch[2] ?? ""} `;
  const continuationIndent = `${bulletMatch[1] ?? ""}${" ".repeat((bulletMatch[2] ?? "").length + 1)}`;
  const words = (bulletMatch[3] ?? "").split(/\s+/u).filter((word) => word.length > 0);
  const wrapped: string[] = [];
  let current = baseIndent;

  for (const word of words) {
    const next =
      visibleLength(current) <= visibleLength(baseIndent)
        ? `${current}${word}`
        : `${current} ${word}`;
    if (visibleLength(current) > visibleLength(baseIndent) && visibleLength(next) > width) {
      wrapped.push(current);
      current = `${continuationIndent}${word}`;
      continue;
    }

    current = next;
  }

  if (current.length > 0) {
    wrapped.push(current);
  }

  return wrapped.join("\n");
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
    .map((line) => wrapRenderedListLine(line, width))
    .join("\n")
    .trimEnd();
};
