import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useReveal } from "../hooks/useReveal";

function RevealProbe() {
  const ref = useReveal<HTMLDivElement>();

  return <div ref={ref} className="reveal">Hello</div>;
}

describe("useReveal", () => {
  it("adds the in class once the element intersects and disconnects the observer", () => {
    const { container } = render(<RevealProbe />);
    const element = container.firstElementChild as HTMLDivElement;
    const Observer = window.IntersectionObserver as unknown as {
      instances: Array<{
        observe: ReturnType<typeof import("vitest").vi.fn>;
        disconnect: ReturnType<typeof import("vitest").vi.fn>;
        trigger: (entry: Partial<IntersectionObserverEntry>) => void;
      }>;
    };

    expect(Observer.instances).toHaveLength(1);
    expect(Observer.instances[0].observe).toHaveBeenCalledWith(element);

    Observer.instances[0].trigger({ isIntersecting: true, target: element });

    expect(element).toHaveClass("reveal", "in");
    expect(Observer.instances[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
