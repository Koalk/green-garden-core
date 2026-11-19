// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Placement chips in the add-plant dialog and edit. Pure rules only; the dialog wires
 * the events. Whether Q-K0 must be asked is decided by `homeQuestionNeeded` in `@green-garden/bulk`.
 */
import { homeQuestionNeeded, typicalPlacement } from "@green-garden/bulk";
import { activeSpaceId, type AppData, type Plant } from "@green-garden/storage";

type Placement = NonNullable<Plant["placement"]>;

/** The chip a catalogue entry starts on: its own placement when its tags give one, else indoors. */
export function defaultPlacementFor(
  row: { readonly tags: readonly string[] } | undefined,
): Placement {
  return typicalPlacement(row as Parameters<typeof typicalPlacement>[0]);
}

/** True when choosing `placement` now must first open Q-K0 (a probe plant goes through the shared rule). */
export function placementNeedsHome(data: AppData, placement: string): boolean {
  if (placement !== "outdoor_pot" && placement !== "ground") return false;
  const probe: Plant = {
    id: "placement-probe",
    spaceId: activeSpaceId(data),
    name: "",
    style: "let_top_dry",
    intervalDays: 7,
    logs: [],
    placement,
  };
  return homeQuestionNeeded(data, { ...data, plants: [...data.plants, probe] });
}

/** The chip to show once Q-K0 has ended: the chosen one if answered, else back where it was (Indoors if nothing else). */
export function placementAfterAsk(before: string, chosen: string, answered: boolean): string {
  if (answered) return chosen;
  return before === chosen ? "indoor" : before;
}

/**
 * The name field after a species is picked. An empty name, or the name the previous pick filled in, takes
 * the new species' name; a name the person typed or changed stays. `auto` is what to remember as filled in.
 */
export function nameAfterPick(
  current: string,
  auto: string | undefined,
  speciesName: string,
): { name: string; auto: string | undefined } {
  const trimmed = current.trim();
  if (trimmed === "" || trimmed === auto) return { name: speciesName, auto: speciesName };
  return { name: current, auto: undefined };
}
