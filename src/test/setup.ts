import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [0.12];

  constructor(
    private readonly callback: IntersectionObserverCallback,
    public readonly options?: IntersectionObserverInit
  ) {
    MockIntersectionObserver.instances.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn<() => IntersectionObserverEntry[]>(() => []);

  trigger(entry: Partial<IntersectionObserverEntry>) {
    this.callback([entry as IntersectionObserverEntry], this);
  }

  static reset() {
    MockIntersectionObserver.instances = [];
  }
}

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  MockIntersectionObserver.reset();
  window.history.pushState({}, "", "/");
});
