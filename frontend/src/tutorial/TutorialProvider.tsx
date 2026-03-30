import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import type { AppRoute } from "../routes";
import type { Locale, ThemeMode } from "../uiText";
import { getTutorialChapter, tutorialRegistry, tutorialUiCopy } from "./registry";
import { getTutorialTarget, isTutorialTargetVisible } from "./targetRegistry";
import {
  getDefaultTutorialState,
  readTutorialState,
  writeTutorialState,
} from "./tutorialStore";
import type {
  TutorialChapter,
  TutorialContextData,
  TutorialPlacement,
  TutorialSession,
  TutorialStoredState,
  TutorialStep,
} from "./types";

type TutorialProviderProps = {
  children: ReactNode;
  isAuthenticated: boolean;
  userName: string | null;
  role: "admin" | "editor" | "viewer" | null;
  route: AppRoute;
  locale: Locale;
  themeMode: ThemeMode;
  activeZoneName: string | null;
  preferredZoneName?: string | null;
  navigate: (route: AppRoute) => void;
};

type TutorialContextValue = {
  openHub: () => void;
  closeHub: () => void;
  startTutorial: () => void;
  startChapter: (chapterId: string) => void;
  resumeTutorial: () => void;
  restartTutorial: () => void;
  replayCurrentChapter: () => void;
  dismissForever: () => void;
  skipForNow: () => void;
  isHubOpen: boolean;
  isTutorialActive: boolean;
  launcherLabel: string;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

function getContextData(props: Omit<TutorialProviderProps, "children" | "navigate">): TutorialContextData {
  return {
    isAuthenticated: props.isAuthenticated,
    userName: props.userName,
    role: props.role,
    isAdmin: props.role === "admin",
    route: props.route,
    locale: props.locale,
    themeMode: props.themeMode,
    activeZoneName: props.activeZoneName,
    preferredZoneName: props.preferredZoneName ?? props.activeZoneName,
  };
}

function resolveStepCopy(step: TutorialStep, locale: Locale, targetMissing: boolean) {
  if (targetMissing && step.fallbackCopy) {
    return step.fallbackCopy[locale];
  }
  return step.copy[locale];
}

function getEligibleChapters(context: TutorialContextData) {
  return tutorialRegistry.filter((chapter) => chapter.isEligible(context));
}

function buildSession(chapterIds: string[], source: TutorialSession["source"], chapterIndex = 0, stepIndex = 0): TutorialSession | null {
  if (chapterIds.length === 0) {
    return null;
  }
  return {
    chapterIds,
    chapterIndex,
    stepIndex,
    source,
  };
}

function getVisibleStep(chapter: TutorialChapter | null, stepIndex: number, context: TutorialContextData) {
  if (!chapter) {
    return null;
  }
  const visibleSteps = chapter.steps.filter((step) => step.predicate?.(context) ?? true);
  return {
    steps: visibleSteps,
    step: visibleSteps[stepIndex] ?? null,
  };
}

function getCoachmarkLayout(
  rect: DOMRect,
  placement: TutorialPlacement,
  cardSize: { width: number; height: number },
): {
  cardStyle: { top: number; left: number; width: number; transform: string };
  connectorPlacement: TutorialPlacement;
} | null {
  const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const margin = 24;
  const width = Math.min(cardSize.width || 360, Math.max(304, viewportWidth - margin * 2));
  const gap = 18;
  const height = Math.min(cardSize.height || 280, viewportHeight - margin * 2);
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const createLayout = (
    top: number,
    left: number,
    connectorPlacement: TutorialPlacement,
  ) => {
    const clampedTop = Math.min(Math.max(top, margin), viewportHeight - height - margin);
    const clampedLeft = Math.min(Math.max(left, margin), viewportWidth - width - margin);

    return {
      cardStyle: {
        top: clampedTop,
        left: clampedLeft,
        width,
        transform: "none",
      },
      connectorPlacement,
    };
  };

  if (placement === "left") {
    const candidateLeft = rect.left - width - gap;
    if (candidateLeft >= margin) {
      return createLayout(centerY - height / 2, candidateLeft, "right");
    }
  }

  if (placement === "right") {
    const candidateLeft = rect.right + gap;
    if (candidateLeft + width + margin <= viewportWidth) {
      return createLayout(centerY - height / 2, candidateLeft, "left");
    }
  }

  if (placement === "top") {
    const candidateTop = rect.top - gap - height;
    if (candidateTop >= margin) {
      return createLayout(candidateTop, centerX - width / 2, "bottom");
    }
  }

  if (placement === "bottom") {
    const candidateTop = rect.bottom + gap;
    if (candidateTop + height + margin <= viewportHeight) {
      return createLayout(candidateTop, centerX - width / 2, "top");
    }
  }

  if (rect.right + gap + width + margin <= viewportWidth) {
    return createLayout(centerY - height / 2, rect.right + gap, "left");
  }

  if (rect.left - width - gap >= margin) {
    return createLayout(centerY - height / 2, rect.left - width - gap, "right");
  }

  if (rect.bottom + height + gap + margin <= viewportHeight) {
    return createLayout(rect.bottom + gap, centerX - width / 2, "top");
  }

  if (rect.top - height - gap >= margin) {
    return createLayout(rect.top - gap - height, centerX - width / 2, "bottom");
  }

  return null;
}

function getCoachmarkConnector(
  targetRect: DOMRect,
  cardRect: { top: number; left: number; width: number; height: number },
  placement: TutorialPlacement,
) {
  let startX = cardRect.left + cardRect.width / 2;
  let startY = cardRect.top + cardRect.height / 2;
  let endX = targetRect.left + targetRect.width / 2;
  let endY = targetRect.top + targetRect.height / 2;

  if (placement === "left") {
    startX = cardRect.left;
    startY = Math.min(Math.max(endY, cardRect.top + 28), cardRect.top + cardRect.height - 28);
    endX = targetRect.right;
  } else if (placement === "right") {
    startX = cardRect.left + cardRect.width;
    startY = Math.min(Math.max(endY, cardRect.top + 28), cardRect.top + cardRect.height - 28);
    endX = targetRect.left;
  } else if (placement === "top") {
    startX = Math.min(Math.max(endX, cardRect.left + 28), cardRect.left + cardRect.width - 28);
    startY = cardRect.top;
    endY = targetRect.bottom;
  } else {
    startX = Math.min(Math.max(endX, cardRect.left + 28), cardRect.left + cardRect.width - 28);
    startY = cardRect.top + cardRect.height;
    endY = targetRect.top;
  }

  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.max(Math.hypot(dx, dy) - 10, 12);
  const angle = Math.atan2(dy, dx);

  return {
    lineStyle: {
      left: `${startX}px`,
      top: `${startY}px`,
      width: `${length}px`,
      transform: `translateY(-50%) rotate(${angle}rad)`,
    },
    tipStyle: {
      left: `${endX}px`,
      top: `${endY}px`,
      transform: `translate(-50%, -50%) rotate(${angle}rad)`,
    },
  };
}

export function TutorialProvider(props: TutorialProviderProps) {
  const contextData = useMemo(
    () => getContextData(props),
    [
      props.activeZoneName,
      props.isAuthenticated,
      props.locale,
      props.preferredZoneName,
      props.role,
      props.route,
      props.themeMode,
      props.userName,
    ],
  );
  const [storedState, setStoredState] = useState<TutorialStoredState>(() =>
    props.isAuthenticated && props.userName ? readTutorialState(props.userName) : getDefaultTutorialState(),
  );
  const [isStorageReady, setIsStorageReady] = useState(() => !props.isAuthenticated || !props.userName);
  const [session, setSession] = useState<TutorialSession | null>(null);
  const [isHubOpen, setIsHubOpen] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [localeAnimating, setLocaleAnimating] = useState(false);
  const autoLaunchGuard = useRef<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.isAuthenticated || !props.userName) {
      setStoredState(getDefaultTutorialState());
      setIsStorageReady(true);
      setSession(null);
      setIsHubOpen(false);
      autoLaunchGuard.current = null;
      return;
    }

    setIsStorageReady(false);
    setStoredState(readTutorialState(props.userName));
    setIsStorageReady(true);
    setSession(null);
    setTargetRect(null);
    setTargetMissing(false);
    autoLaunchGuard.current = null;
  }, [props.isAuthenticated, props.userName]);

  const updateStoredState = useCallback(
    (updater: (current: TutorialStoredState) => TutorialStoredState) => {
      if (!props.userName) {
        return;
      }
      setStoredState((current) => {
        const next = updater(current);
        writeTutorialState(props.userName, next);
        return next;
      });
    },
    [props.userName],
  );

  const chapters = useMemo(() => getEligibleChapters(contextData), [contextData]);
  const currentChapter = useMemo(
    () => (session ? getTutorialChapter(session.chapterIds[session.chapterIndex]) : null),
    [session],
  );
  const currentStepInfo = useMemo(
    () => getVisibleStep(currentChapter, session?.stepIndex ?? 0, contextData),
    [contextData, currentChapter, session?.stepIndex],
  );
  const currentStep = currentStepInfo?.step ?? null;

  const closeTutorial = useCallback(() => {
    setSession(null);
    setTargetRect(null);
    setTargetMissing(false);
  }, []);

  const startTutorialSession = useCallback(
    (nextSession: TutorialSession | null) => {
      if (!nextSession) {
        return;
      }
      const chapterId = nextSession.chapterIds[nextSession.chapterIndex] ?? null;
      const chapter = chapterId ? getTutorialChapter(chapterId) : null;
      const step = chapter ? getVisibleStep(chapter, nextSession.stepIndex, contextData)?.step ?? null : null;
      updateStoredState((current) => ({
        ...current,
        status: "in_progress",
        activeChapterId: chapterId,
        activeStepId: step?.id ?? null,
        lastRouteKind: contextData.route.kind,
      }));
      startTransition(() => {
        setSession(nextSession);
        setIsHubOpen(false);
      });
    },
    [contextData, updateStoredState],
  );

  const startTutorial = useCallback(() => {
    const chapterIds = chapters.map((chapter) => chapter.id);
    startTutorialSession(buildSession(chapterIds, "manual"));
  }, [chapters, startTutorialSession]);

  const startChapter = useCallback(
    (chapterId: string) => {
      const chapter = getTutorialChapter(chapterId);
      if (!chapter || !chapter.isEligible(contextData)) {
        return;
      }
      startTutorialSession(buildSession([chapterId], "chapter"));
    },
    [contextData, startTutorialSession],
  );

  const resumeTutorial = useCallback(() => {
    if (storedState.status !== "in_progress" || !storedState.activeChapterId) {
      return;
    }
    const eligibleIds = chapters.map((chapter) => chapter.id);
    const chapterIndex = eligibleIds.indexOf(storedState.activeChapterId);
    if (chapterIndex === -1) {
      return;
    }
    const chapter = getTutorialChapter(storedState.activeChapterId);
    const visibleSteps = chapter ? getVisibleStep(chapter, 0, contextData)?.steps ?? [] : [];
    const stepIndex = Math.max(
      0,
      visibleSteps.findIndex((step) => step.id === storedState.activeStepId),
    );
    startTutorialSession(buildSession(eligibleIds, "auto", chapterIndex, stepIndex === -1 ? 0 : stepIndex));
  }, [chapters, contextData, startTutorialSession, storedState.activeChapterId, storedState.activeStepId, storedState.status]);

  const restartTutorial = useCallback(() => {
    updateStoredState(() => getDefaultTutorialState());
    startTutorial();
  }, [startTutorial, updateStoredState]);

  const replayCurrentChapter = useCallback(() => {
    if (!session) {
      return;
    }
    const chapterId = session.chapterIds[session.chapterIndex];
    startTutorialSession(buildSession([chapterId], "chapter"));
  }, [session, startTutorialSession]);

  const skipForNow = useCallback(() => {
    if (!session || !currentStep) {
      return;
    }
    updateStoredState((current) => ({
      ...current,
      status: "in_progress",
      activeChapterId: currentChapter?.id ?? current.activeChapterId,
      activeStepId: currentStep.id,
      lastRouteKind: contextData.route.kind,
    }));
    closeTutorial();
  }, [closeTutorial, contextData.route.kind, currentChapter?.id, currentStep, session, updateStoredState]);

  const dismissForever = useCallback(() => {
    updateStoredState((current) => ({
      ...current,
      status: "dismissed_forever",
      activeChapterId: null,
      activeStepId: null,
      lastRouteKind: contextData.route.kind,
    }));
    closeTutorial();
    setIsHubOpen(false);
  }, [closeTutorial, contextData.route.kind, updateStoredState]);

  const advanceSession = useCallback(() => {
    if (!session || !currentStepInfo || !currentChapter || !currentStep) {
      return;
    }

    const nextRoute =
      typeof currentStep.onNextNavigate === "function"
        ? currentStep.onNextNavigate(contextData)
        : currentStep.onNextNavigate ?? null;
    const targetZoneName =
      currentStep.targetId
        ? getTutorialTarget(currentStep.targetId)?.getAttribute("data-zone-name")
        : null;
    const resolvedNextRoute =
      nextRoute?.kind === "zone" && nextRoute.zoneName.length === 0 && targetZoneName
        ? { kind: "zone" as const, zoneName: targetZoneName }
        : nextRoute;
    if (resolvedNextRoute) {
      props.navigate(resolvedNextRoute);
    }

    if (session.stepIndex < currentStepInfo.steps.length - 1) {
      const nextStepIndex = session.stepIndex + 1;
      const nextStep = currentStepInfo.steps[nextStepIndex];
      const nextSession = { ...session, stepIndex: nextStepIndex };
      setSession(nextSession);
      updateStoredState((current) => ({
        ...current,
        status: "in_progress",
        activeChapterId: currentChapter.id,
        activeStepId: nextStep?.id ?? null,
        lastRouteKind: props.route.kind,
      }));
      return;
    }

    const completedChapterIds = Array.from(new Set([...storedState.completedChapterIds, currentChapter.id]));
    let chapterIds = session.chapterIds;
    let nextChapterIndex = session.chapterIndex + 1;

    if (currentStep.nextChapterId) {
      const existingIndex = chapterIds.indexOf(currentStep.nextChapterId);
      if (existingIndex === -1) {
        chapterIds = [
          ...chapterIds.slice(0, session.chapterIndex + 1),
          currentStep.nextChapterId,
          ...chapterIds.slice(session.chapterIndex + 1),
        ];
      } else if (existingIndex > session.chapterIndex) {
        nextChapterIndex = existingIndex;
      }
    }

    if (nextChapterIndex < chapterIds.length) {
      const nextChapterId = chapterIds[nextChapterIndex];
      const nextChapter = getTutorialChapter(nextChapterId);
      const nextStep = nextChapter ? getVisibleStep(nextChapter, 0, contextData)?.step ?? null : null;
      const nextSession = { ...session, chapterIds, chapterIndex: nextChapterIndex, stepIndex: 0 };
      setSession(nextSession);
      updateStoredState((current) => ({
        ...current,
        status: "in_progress",
        completedChapterIds,
        activeChapterId: nextChapterId,
        activeStepId: nextStep?.id ?? null,
        lastRouteKind: props.route.kind,
      }));
      return;
    }

    updateStoredState((current) => ({
      ...current,
      status: "completed",
      completedChapterIds,
      activeChapterId: null,
      activeStepId: null,
      lastRouteKind: props.route.kind,
    }));
    closeTutorial();
  }, [
    closeTutorial,
    contextData,
    currentChapter,
    currentStep,
    currentStepInfo,
    props,
    session,
    storedState.completedChapterIds,
    updateStoredState,
  ]);

  const goBack = useCallback(() => {
    if (!session || !currentChapter) {
      return;
    }
    if (session.stepIndex > 0) {
      const previousStep = currentStepInfo?.steps[session.stepIndex - 1] ?? null;
      const nextSession = { ...session, stepIndex: session.stepIndex - 1 };
      setSession(nextSession);
      updateStoredState((current) => ({
        ...current,
        activeChapterId: currentChapter.id,
        activeStepId: previousStep?.id ?? null,
        lastRouteKind: props.route.kind,
      }));
      return;
    }
    if (session.chapterIndex > 0) {
      const previousChapterId = session.chapterIds[session.chapterIndex - 1];
      const previousChapter = getTutorialChapter(previousChapterId);
      const previousSteps = previousChapter ? getVisibleStep(previousChapter, 0, contextData)?.steps ?? [] : [];
      const previousStep = previousSteps[previousSteps.length - 1] ?? null;
      const nextSession = {
        ...session,
        chapterIndex: session.chapterIndex - 1,
        stepIndex: Math.max(previousSteps.length - 1, 0),
      };
      setSession(nextSession);
      updateStoredState((current) => ({
        ...current,
        activeChapterId: previousChapterId,
        activeStepId: previousStep?.id ?? null,
        lastRouteKind: props.route.kind,
      }));
    }
  }, [contextData, currentChapter, currentStepInfo?.steps, props.route.kind, session, updateStoredState]);

  useEffect(() => {
    if (
      !isStorageReady ||
      !props.isAuthenticated ||
      !props.userName ||
      autoLaunchGuard.current === props.userName
    ) {
      return;
    }
    autoLaunchGuard.current = props.userName;
    if (storedState.status === "dismissed_forever" || storedState.status === "completed") {
      return;
    }
    if (storedState.status === "in_progress") {
      resumeTutorial();
      return;
    }
    startTutorialSession(buildSession(chapters.map((chapter) => chapter.id), "auto"));
  }, [
    chapters,
    isStorageReady,
    props.isAuthenticated,
    props.userName,
    resumeTutorial,
    startTutorialSession,
    storedState.status,
  ]);

  useEffect(() => {
    if (!session || !currentChapter || !currentStep) {
      return;
    }
    const ensureRoute =
      currentStep.ensureRoute?.kind === "zone" && currentStep.ensureRoute.zoneName.length === 0
        ? {
            kind: "zone" as const,
            zoneName:
              contextData.activeZoneName ??
              props.preferredZoneName ??
              (props.route.kind === "zone" ? props.route.zoneName : ""),
          }
        : currentStep.ensureRoute;
    if (
      ensureRoute &&
      (props.route.kind !== ensureRoute.kind ||
        (ensureRoute.kind === "zone" &&
          props.route.kind === "zone" &&
          ensureRoute.zoneName.length > 0 &&
          props.route.zoneName !== ensureRoute.zoneName))
    ) {
      props.navigate(ensureRoute);
      return;
    }
    updateStoredState((current) => ({
      ...current,
      activeChapterId: currentChapter.id,
      activeStepId: currentStep.id,
      lastRouteKind: props.route.kind,
    }));
  }, [currentChapter, currentStep, props, session, updateStoredState]);

  useEffect(() => {
    if (!session || !currentStep) {
      return;
    }
    if (currentStep.type !== "coachmark" || !currentStep.targetId) {
      setTargetRect(null);
      setTargetMissing(false);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    const waitForMs = currentStep.waitForMs ?? 2200;

    const update = () => {
      if (cancelled) {
        return;
      }
      const targetId = currentStep.targetId;
      if (!targetId) {
        setTargetRect(null);
        setTargetMissing(true);
        return;
      }
      const target = getTutorialTarget(targetId);
      if (target && isTutorialTargetVisible(target)) {
        setTargetRect(target.getBoundingClientRect());
        setTargetMissing(false);
        window.requestAnimationFrame(update);
        return;
      }
      if (Date.now() - startedAt >= waitForMs) {
        setTargetRect(null);
        setTargetMissing(true);
        return;
      }
      window.setTimeout(update, 120);
    };

    update();

    const handleViewport = () => {
      const target = currentStep.targetId ? getTutorialTarget(currentStep.targetId) : null;
      if (target && isTutorialTargetVisible(target)) {
        setTargetRect(target.getBoundingClientRect());
      }
    };

    window.addEventListener("resize", handleViewport);
    window.addEventListener("scroll", handleViewport, true);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", handleViewport);
      window.removeEventListener("scroll", handleViewport, true);
    };
  }, [currentStep, session]);

  useEffect(() => {
    if (!session || !cardRef.current) {
      return;
    }
    cardRef.current.focus();
  }, [currentStep, session]);

  useEffect(() => {
    setLocaleAnimating(true);
    const timer = window.setTimeout(() => setLocaleAnimating(false), 180);
    return () => window.clearTimeout(timer);
  }, [props.locale, props.themeMode]);

  useEffect(() => {
    if (!session && !isHubOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (session) {
          skipForNow();
        } else {
          setIsHubOpen(false);
        }
        return;
      }
      if (!session) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        advanceSession();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [advanceSession, goBack, isHubOpen, session, skipForNow]);

  const value = useMemo<TutorialContextValue>(
    () => ({
      openHub: () => setIsHubOpen(true),
      closeHub: () => setIsHubOpen(false),
      startTutorial,
      startChapter,
      resumeTutorial,
      restartTutorial,
      replayCurrentChapter,
      dismissForever,
      skipForNow,
      isHubOpen,
      isTutorialActive: session !== null,
      launcherLabel: tutorialUiCopy[props.locale].launcher,
    }),
    [
      dismissForever,
      isHubOpen,
      props.locale,
      replayCurrentChapter,
      restartTutorial,
      resumeTutorial,
      session,
      skipForNow,
      startChapter,
      startTutorial,
    ],
  );

  const overallChapterIndex = session ? session.chapterIndex + 1 : 0;
  const totalChapterCount = session?.chapterIds.length ?? chapters.length;
  const chapterStepCount = currentStepInfo?.steps.length ?? 0;
  const currentStepIndex = session ? session.stepIndex + 1 : 0;
  const activeCopy = currentStep
    ? resolveStepCopy(currentStep, props.locale, targetMissing)
    : null;

  return (
    <TutorialContext.Provider value={value}>
      {props.children}
      {typeof document !== "undefined"
        ? createPortal(
            <>
              {isHubOpen ? (
                <TutorialHub
                  chapters={tutorialRegistry}
                  closeHub={() => setIsHubOpen(false)}
                  contextData={contextData}
                  currentChapterId={session ? session.chapterIds[session.chapterIndex] : storedState.activeChapterId}
                  locale={props.locale}
                  replayCurrentChapter={replayCurrentChapter}
                  restartTutorial={restartTutorial}
                  resumeTutorial={resumeTutorial}
                  startChapter={startChapter}
                  startTutorial={startTutorial}
                  status={storedState}
                />
              ) : null}
              {session && currentStep && activeCopy ? (
                <TutorialOverlay
                  activeCopy={activeCopy}
                  placement={currentStep.placement ?? "bottom"}
                  cardRef={cardRef}
                  chapterLabel={currentChapter?.copy[props.locale].label ?? ""}
                  chapterStepCount={chapterStepCount}
                  closeTutorial={skipForNow}
                  currentStepIndex={currentStepIndex}
                  goBack={goBack}
                  locale={props.locale}
                  localeAnimating={localeAnimating}
                  onDismissForever={dismissForever}
                  onNext={advanceSession}
                  overallChapterIndex={overallChapterIndex}
                  targetMissing={targetMissing}
                  targetRect={targetRect}
                  themeMode={props.themeMode}
                  totalChapterCount={totalChapterCount}
                  stepType={currentStep.type}
                  canDismissForever={currentStep.canDismissForever ?? true}
                  canGoBack={session.chapterIndex > 0 || session.stepIndex > 0}
                  canSkip={currentStep.canSkip ?? true}
                />
              ) : null}
            </>,
            document.body,
          )
        : null}
    </TutorialContext.Provider>
  );
}

type TutorialHubProps = {
  chapters: TutorialChapter[];
  closeHub: () => void;
  contextData: TutorialContextData;
  currentChapterId: string | null;
  locale: Locale;
  replayCurrentChapter: () => void;
  restartTutorial: () => void;
  resumeTutorial: () => void;
  startChapter: (chapterId: string) => void;
  startTutorial: () => void;
  status: TutorialStoredState;
};

function TutorialHub(props: TutorialHubProps) {
  const ui = tutorialUiCopy[props.locale];
  return (
    <div className="tutorial-layer" role="presentation">
      <div className="tutorial-backdrop" />
      <div className="tutorial-hub" aria-labelledby="tutorial-hub-title" role="dialog" aria-modal="true">
        <div className="tutorial-hub-header">
          <div>
            <p className="tutorial-kicker">{ui.chapterListTitle}</p>
            <h2 id="tutorial-hub-title">{ui.hubTitle}</h2>
            <p>{ui.hubBody}</p>
          </div>
          <button className="secondary-button" onClick={props.closeHub} type="button">
            {ui.close}
          </button>
        </div>
        <div className="tutorial-hub-actions">
          {props.status.status === "in_progress" ? (
            <button className="primary-button" onClick={props.resumeTutorial} type="button">
              {ui.continue}
            </button>
          ) : (
            <button className="primary-button" onClick={props.startTutorial} type="button">
              {ui.restart}
            </button>
          )}
          <button className="secondary-button" onClick={props.restartTutorial} type="button">
            {ui.restart}
          </button>
          {props.currentChapterId ? (
            <button className="secondary-button" onClick={props.replayCurrentChapter} type="button">
              {ui.replay}
            </button>
          ) : null}
        </div>
        <div className="tutorial-hub-list">
          {props.chapters.map((chapter) => {
            const eligible = chapter.isEligible(props.contextData);
            const isCurrent = props.currentChapterId === chapter.id;
            const isCompleted = props.status.completedChapterIds.includes(chapter.id);
            const meta = chapter.copy[props.locale];
            return (
              <div
                key={chapter.id}
                className={`tutorial-hub-card ${isCurrent ? "tutorial-hub-card-current" : ""}`}
              >
                <div className="tutorial-hub-card-copy">
                  <div className="tutorial-hub-status">
                    <span>{meta.label}</span>
                    <strong>
                      {isCurrent
                        ? ui.current
                        : isCompleted
                          ? ui.completed
                          : eligible
                            ? ui.available
                            : ui.locked}
                    </strong>
                  </div>
                  <p>{meta.description}</p>
                </div>
                <button
                  className="secondary-button"
                  disabled={!eligible}
                  onClick={() => props.startChapter(chapter.id)}
                  type="button"
                >
                  {ui.replay}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type TutorialOverlayProps = {
  activeCopy: { title: string; body: string; note?: string; primaryLabel?: string };
  cardRef: RefObject<HTMLDivElement | null>;
  placement: TutorialPlacement;
  chapterLabel: string;
  chapterStepCount: number;
  closeTutorial: () => void;
  currentStepIndex: number;
  locale: Locale;
  localeAnimating: boolean;
  onDismissForever: () => void;
  onNext: () => void;
  goBack: () => void;
  overallChapterIndex: number;
  stepType: "modal" | "coachmark";
  targetMissing: boolean;
  targetRect: DOMRect | null;
  themeMode: ThemeMode;
  totalChapterCount: number;
  canDismissForever: boolean;
  canGoBack: boolean;
  canSkip: boolean;
};

function TutorialOverlay(props: TutorialOverlayProps) {
  const ui = tutorialUiCopy[props.locale];
  const [cardSize, setCardSize] = useState({ width: 360, height: 280 });

  useLayoutEffect(() => {
    const node = props.cardRef.current;
    if (!node) {
      return;
    }

    const updateSize = () => {
      const nextWidth = node.offsetWidth || 360;
      const nextHeight = node.offsetHeight || 280;
      setCardSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.activeCopy.body, props.activeCopy.note, props.activeCopy.title, props.cardRef, props.locale]);

  const coachmarkLayout =
    props.stepType === "coachmark" && props.targetRect && !props.targetMissing
      ? getCoachmarkLayout(props.targetRect, props.placement, cardSize)
      : null;
  const cardStyle = coachmarkLayout?.cardStyle;
  const connector =
    coachmarkLayout && props.targetRect
      ? getCoachmarkConnector(props.targetRect, {
          top: coachmarkLayout.cardStyle.top,
          left: coachmarkLayout.cardStyle.left,
          width: coachmarkLayout.cardStyle.width,
          height: cardSize.height,
        }, coachmarkLayout.connectorPlacement)
      : null;

  return (
    <div className={`tutorial-layer tutorial-layer-${props.themeMode}`} role="presentation">
      <div className="tutorial-backdrop" />
      {connector ? (
        <>
          <span className="tutorial-connector-line" style={connector.lineStyle} />
          <span className="tutorial-connector-tip" style={connector.tipStyle} />
        </>
      ) : null}
      <div
        className={`tutorial-card tutorial-card-${props.stepType} ${
          props.localeAnimating ? "tutorial-card-locale-switching" : ""
        }`}
        ref={props.cardRef}
        role="dialog"
        aria-modal={props.stepType === "modal" || props.targetMissing}
        aria-labelledby="tutorial-card-title"
        style={cardStyle}
        tabIndex={-1}
      >
        <div className="tutorial-card-frame">
          <div className="tutorial-progress">
            <div>
              <span>{ui.progressOverall}</span>
              <strong>
                {props.overallChapterIndex}/{props.totalChapterCount}
              </strong>
            </div>
            <div>
              <span>{ui.progressChapter}</span>
              <strong>
                {props.currentStepIndex}/{props.chapterStepCount}
              </strong>
            </div>
          </div>
          <div className="tutorial-card-copy">
            <p className="tutorial-kicker">{props.chapterLabel}</p>
            <h2 id="tutorial-card-title">{props.activeCopy.title}</h2>
            <p>{props.activeCopy.body}</p>
            {props.activeCopy.note ? <p className="tutorial-note">{props.activeCopy.note}</p> : null}
            {props.targetMissing ? <p className="tutorial-note">{ui.targetMissingBody}</p> : null}
          </div>
          <div className="tutorial-card-actions">
            <div className="tutorial-card-actions-secondary">
              {props.canGoBack ? (
                <button className="secondary-button" onClick={props.goBack} type="button">
                  {ui.back}
                </button>
              ) : null}
              {props.canSkip ? (
                <button className="secondary-button" onClick={props.closeTutorial} type="button">
                  {ui.skipForNow}
                </button>
              ) : null}
              {props.canDismissForever ? (
                <button className="secondary-button" onClick={props.onDismissForever} type="button">
                  {ui.neverShowAgain}
                </button>
              ) : null}
            </div>
            <button className="primary-button" onClick={props.onNext} type="button">
              {props.activeCopy.primaryLabel ??
                (props.overallChapterIndex === props.totalChapterCount &&
                props.currentStepIndex === props.chapterStepCount
                  ? ui.finish
                  : ui.next)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error("useTutorial must be used inside TutorialProvider");
  }
  return context;
}
