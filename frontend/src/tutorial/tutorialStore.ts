import type { AppRoute } from "../routes";
import type { TutorialStoredState } from "./types";

export const TUTORIAL_STORAGE_KEY = "zonix.tutorial.v1";

type TutorialStorageShape = Record<string, TutorialStoredState>;

const defaultStoredState: TutorialStoredState = {
  status: "never_started",
  completedChapterIds: [],
  activeChapterId: null,
  activeStepId: null,
  lastRouteKind: null,
  updatedAt: new Date(0).toISOString(),
};

function isStoredRouteKind(value: unknown): value is AppRoute["kind"] {
  return (
    value === "zones" ||
    value === "zone" ||
    value === "backends" ||
    value === "audit" ||
    value === "admin-access" ||
    value === "admin-backends" ||
    value === "admin-identity" ||
    value === "auth"
  );
}

function sanitizeStoredState(value: unknown): TutorialStoredState {
  if (!value || typeof value !== "object") {
    return defaultStoredState;
  }

  const candidate = value as Partial<TutorialStoredState>;
  return {
    status:
      candidate.status === "in_progress" ||
      candidate.status === "completed" ||
      candidate.status === "dismissed_forever" ||
      candidate.status === "never_started"
        ? candidate.status
        : "never_started",
    completedChapterIds: Array.isArray(candidate.completedChapterIds)
      ? candidate.completedChapterIds.filter((item): item is string => typeof item === "string")
      : [],
    activeChapterId: typeof candidate.activeChapterId === "string" ? candidate.activeChapterId : null,
    activeStepId: typeof candidate.activeStepId === "string" ? candidate.activeStepId : null,
    lastRouteKind: isStoredRouteKind(candidate.lastRouteKind) ? candidate.lastRouteKind : null,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.length > 0
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

function readStorageShape(): TutorialStorageShape {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        sanitizeStoredState(value),
      ]),
    );
  } catch {
    return {};
  }
}

function writeStorageShape(next: TutorialStorageShape) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(next));
}

export function readTutorialState(userName: string | null | undefined): TutorialStoredState {
  if (!userName) {
    return defaultStoredState;
  }
  const state = readStorageShape();
  return state[userName] ?? defaultStoredState;
}

export function writeTutorialState(
  userName: string | null | undefined,
  nextState: TutorialStoredState,
) {
  if (!userName) {
    return;
  }
  const state = readStorageShape();
  state[userName] = {
    ...nextState,
    updatedAt: new Date().toISOString(),
  };
  writeStorageShape(state);
}

export function clearTutorialState(userName: string | null | undefined) {
  if (!userName) {
    return;
  }
  const state = readStorageShape();
  delete state[userName];
  writeStorageShape(state);
}

export function getDefaultTutorialState(): TutorialStoredState {
  return {
    ...defaultStoredState,
    completedChapterIds: [],
  };
}
