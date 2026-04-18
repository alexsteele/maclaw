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
  const rendered = renderer.parse(text);
  return typeof rendered === "string" ? rendered.trimEnd() : text;
};
