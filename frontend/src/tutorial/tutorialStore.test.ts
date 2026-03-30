import { beforeEach, describe, expect, it } from "vitest";

import {
  TUTORIAL_STORAGE_KEY,
  getDefaultTutorialState,
  readTutorialState,
  writeTutorialState,
} from "./tutorialStore";

describe("tutorialStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the default state for a user with no persisted record", () => {
    expect(readTutorialState("alice")).toEqual(getDefaultTutorialState());
  });

  it("persists tutorial progress per username", () => {
    writeTutorialState("alice", {
      status: "in_progress",
      completedChapterIds: ["welcome-shell"],
      activeChapterId: "zones-overview",
      activeStepId: "zones-search",
      lastRouteKind: "zones",
      updatedAt: new Date(0).toISOString(),
    });

    expect(readTutorialState("alice")).toMatchObject({
      status: "in_progress",
      completedChapterIds: ["welcome-shell"],
      activeChapterId: "zones-overview",
      activeStepId: "zones-search",
      lastRouteKind: "zones",
    });
    expect(JSON.parse(window.localStorage.getItem(TUTORIAL_STORAGE_KEY) ?? "{}")).toHaveProperty(
      "alice",
    );
  });
});
