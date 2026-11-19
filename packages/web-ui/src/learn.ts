// SPDX-License-Identifier: AGPL-3.0-only

/** "Learn more" links per language and the "Not sure what it is?" help for names we cannot find. */
import { learnMoreLinks, type LearnLink } from "@green-garden/catalogue";
import { getLocale } from "@green-garden/i18n";
import { esc, t } from "./text.ts";

const LENS = "https://lens.google.com/";

/** The Learn more section for the UI language; empty when the plant has no links. */
export function learnMoreHtml(links: readonly LearnLink[] | undefined): string {
  if (links === undefined || links.length === 0) return "";
  const shown = learnMoreLinks(links, getLocale());
  if (shown.length === 0) return "";
  const items = shown
    .map(
      (l) =>
        `<li><a href="${esc(l.url)}" rel="noopener noreferrer" target="_blank">${esc(l.title)}</a>
        <small>${esc(l.publisher)}${l.inEnglish ? `, ${esc(t("learn.inEnglish"))}` : ""}</small></li>`,
    )
    .join("");
  return `<section class="learn-more"><h4>${esc(t("learn.heading"))}</h4><ul>${items}</ul></section>`;
}

/** Shown where a typed name found nothing: a pointer to reverse image search. */
export function notSureWhatHtml(): string {
  return `<p class="not-sure-what"><strong>${esc(t("learn.notSure"))}</strong>
    <a href="${LENS}" rel="noopener noreferrer" target="_blank">${esc(t("learn.lens"))}</a>
    <small>${esc(t("learn.anySearch"))}</small></p>`;
}
