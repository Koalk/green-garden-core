// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The drip-fed question bank and its pacing: which question to ask about a plant
 * next, and when to stay quiet. Pure data and functions; no storage, no UI, no clock (callers pass today).
 */
export {
  HOME_REGIONS,
  followUpFor,
  homeFor,
  type Home,
  type HomeClimate,
  type HomeFollowUp,
  type HomeFollowUpOption,
  type HomeRegion,
  type HomeWinterMin,
} from "./home.ts";
export { DEFAULTS_TABLE, type DefaultsRow } from "./defaults.ts";
export {
  COMMON_TEXT,
  PACING,
  QUESTIONS,
  askLater,
  hasWaitingQuestion,
  markAsked,
  neverAsk,
  neverAskPlant,
  nextQuestion,
  rankQuestions,
  type FieldSource,
  type Locale,
  type Mode,
  type Options,
  type Placement,
  type PlantQuestionState,
  type Question,
  type QuestionPlant,
  type QuestionState,
  type QuestionText,
  type Tier,
} from "./next.ts";
