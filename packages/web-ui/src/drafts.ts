// SPDX-License-Identifier: AGPL-3.0-only

/** Drafts and the add-plant form's pure helpers live in `@green-garden/bulk`; this binds web-ui's `t`. */
import { validatePlantFields as validateWith } from "@green-garden/bulk";
import { t } from "./text.ts";

export {
  deleteDraft,
  draftFields,
  hasUnsavedChanges,
  plantFieldIssues,
  plantFromFields,
  saveDraft,
  type FieldIssue,
} from "@green-garden/bulk";

/** What stops the modal from saving a plant, worded for the active locale. */
export function validatePlantFields(f: Readonly<Record<string, string>>): string[] {
  return validateWith(f, t);
}
