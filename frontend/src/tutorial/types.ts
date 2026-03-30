import type { AppRoute } from "../routes";
import type { Locale, ThemeMode } from "../uiText";

export type TutorialStatus =
  | "never_started"
  | "in_progress"
  | "completed"
  | "dismissed_forever";

export type TutorialPlacement = "top" | "right" | "bottom" | "left";
export type TutorialStepType = "modal" | "coachmark";
export type TutorialChapterKind = "core" | "route";
export type TutorialRole = "admin" | "editor" | "viewer" | null;

export type TutorialStoredState = {
  status: TutorialStatus;
  completedChapterIds: string[];
  activeChapterId: string | null;
  activeStepId: string | null;
  lastRouteKind: AppRoute["kind"] | null;
  updatedAt: string;
};

export type TutorialCopy = {
  title: string;
  body: string;
  note?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
};

export type TutorialContextData = {
  isAuthenticated: boolean;
  userName: string | null;
  role: TutorialRole;
  isAdmin: boolean;
  route: AppRoute;
  locale: Locale;
  themeMode: ThemeMode;
  activeZoneName: string | null;
  preferredZoneName?: string | null;
};

export type TutorialStep = {
  id: string;
  type: TutorialStepType;
  copy: Record<Locale, TutorialCopy>;
  fallbackCopy?: Record<Locale, TutorialCopy>;
  targetId?: string;
  placement?: TutorialPlacement;
  ensureRoute?: AppRoute;
  waitForMs?: number;
  canSkip?: boolean;
  canDismissForever?: boolean;
  predicate?: (context: TutorialContextData) => boolean;
  onNextNavigate?: AppRoute | ((context: TutorialContextData) => AppRoute | null);
  nextChapterId?: string;
};

export type TutorialChapter = {
  id: string;
  kind: TutorialChapterKind;
  routeKinds: AppRoute["kind"][];
  copy: Record<
    Locale,
    {
      label: string;
      description: string;
    }
  >;
  isEligible: (context: TutorialContextData) => boolean;
  steps: TutorialStep[];
};

export type TutorialSession = {
  chapterIds: string[];
  chapterIndex: number;
  stepIndex: number;
  source: "auto" | "manual" | "chapter";
};
