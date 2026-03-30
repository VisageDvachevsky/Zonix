import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { AppRoute } from "../routes";
import { TutorialProvider, useTutorial } from "./TutorialProvider";
import { TUTORIAL_STORAGE_KEY, readTutorialState } from "./tutorialStore";

function Harness(props: {
  isAuthenticated?: boolean;
  role?: "admin" | "editor" | "viewer" | null;
  route?: AppRoute;
  userName?: string | null;
}) {
  const {
    isAuthenticated = true,
    role = "admin",
    route = { kind: "zones" },
    userName = "alice",
  } = props;

  return (
    <TutorialProvider
      activeZoneName={route.kind === "zone" ? route.zoneName : "example.com"}
      isAuthenticated={isAuthenticated}
      locale="en"
      navigate={() => undefined}
      role={role}
      route={route}
      themeMode="dark"
      userName={userName}
    >
      <HarnessInner />
      <div data-tour="shell-nav-zones">Zones</div>
      <div data-tour="shell-header-primary">Summary</div>
      <div data-tour="shell-locale-toggle">EN RU</div>
      <div data-tour="shell-theme-toggle">Theme</div>
      <div data-tour="shell-tutorial-launcher">Launch point</div>
    </TutorialProvider>
  );
}

function HarnessInner() {
  const tutorial = useTutorial();
  return (
    <button onClick={tutorial.openHub} type="button">
      Open tutorial hub
    </button>
  );
}

describe("TutorialProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("auto-starts onboarding for a new authenticated user and persists skip state", async () => {
    render(<Harness />);

    expect(await screen.findByText("Welcome to Zonix")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() =>
      expect(readTutorialState("alice")).toMatchObject({
        status: "in_progress",
        activeChapterId: "welcome-shell",
        activeStepId: "welcome-intro",
      }),
    );
  });

  it("keeps the hub available after permanent dismissal", async () => {
    render(<Harness />);

    fireEvent.click(await screen.findByRole("button", { name: "Never show again" }));
    fireEvent.click(screen.getByRole("button", { name: "Open tutorial hub" }));

    expect(await screen.findByText("Tutorials")).toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Replay chapter" }).length).toBeGreaterThan(0);
  });

  it("does not auto-start again when dismissed forever is already persisted", async () => {
    window.localStorage.setItem(
      TUTORIAL_STORAGE_KEY,
      JSON.stringify({
        alice: {
          status: "dismissed_forever",
          completedChapterIds: [],
          activeChapterId: null,
          activeStepId: null,
          lastRouteKind: "zones",
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    render(<Harness />);

    await waitFor(() =>
      expect(screen.queryByText("Welcome to Zonix")).not.toBeInTheDocument(),
    );
    expect(readTutorialState("alice").status).toBe("dismissed_forever");
  });
});
