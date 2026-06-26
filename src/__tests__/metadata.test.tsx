import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import indexHtml from "../../index.html?raw";

describe("metadata", () => {
  it("keeps core document metadata in the html shell", () => {
    expect(indexHtml).toContain("Mojtaba Keivanlou");
    expect(indexHtml).toContain('rel="canonical" href="https://mojtabakeivanlou.com"');
    expect(indexHtml).toContain('property="og:image"');
    expect(indexHtml).toContain("https://mojtabakeivanlou.com/assets/img/profile.jpeg");
  });

  it("renders person structured data from React", () => {
    window.history.pushState({}, "", "/");

    render(<App />);

    const script = screen.getByTestId("person-json-ld");
    const data = JSON.parse(script.textContent ?? "{}");

    expect(data["@type"]).toBe("Person");
    expect(data.name).toBe("Mojtaba Keivanlou");
    expect(data.jobTitle).toBe("Principal Hydraulic & Water Resources Engineer");
    expect(data.email).toBe("keyvanlu.m@gmail.com");
    expect(data.sameAs).toContain("https://linkedin.com/in/MojtabaKeivanlou");
    expect(data.knowsAbout).toContain("HEC-RAS");
  });
});
