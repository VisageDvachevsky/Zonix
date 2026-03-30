export function getTutorialTargetSelector(targetId: string) {
  return `[data-tour="${targetId}"]`;
}

export function getTutorialTarget(targetId: string): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const node = document.querySelector(getTutorialTargetSelector(targetId));
  return node instanceof HTMLElement ? node : null;
}

export function isTutorialTargetVisible(node: HTMLElement | null) {
  if (!node) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
