// SPDX-License-Identifier: AGPL-3.0-only

export { petToxicityWarnings, stats, validateCatalogue, type Stats } from "./validate.ts";
export {
  learnMoreLinks,
  linksOfEntry,
  LINK_KINDS,
  type LearnLink,
  type LinkKind,
  type LinkSource,
  type ResolvedLink,
} from "./links.ts";
export {
  createNameMatcher,
  MATCH_THRESHOLDS,
  matchNames,
  type Candidate,
  type MatchOptions,
  type MatchReason,
  type MatchResult,
  type MatcherEntry,
  type NameMatcher,
  type Verdict,
} from "./matcher.ts";
export {
  commonsFilePageUrl,
  commonsFileUrl,
  normaliseCommonsLicence,
  PHOTO_SIZES,
} from "./photos.ts";
