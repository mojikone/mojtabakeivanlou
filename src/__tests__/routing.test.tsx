import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";

describe("route shells", () => {
  it("renders the home route shell at the root path", () => {
    window.history.pushState({}, "", "/");

    render(<App />);

    expect(screen.getByRole("main")).toHaveAttribute("data-route", "home");
    expect(screen.getByRole("heading", { name: "Mojtaba Keivanlou" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Engineering Services" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Experience" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skills & Software" })).toBeInTheDocument();
    expect(screen.queryByText("Selected Work")).not.toBeInTheDocument();
  });

  it("renders the contact route shell for the contact routes", () => {
    window.history.pushState({}, "", "/contact");

    render(<App />);

    expect(screen.getByText("Contact route shell")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("data-route", "contact");
  });

  it("renders the thank-you route shell for the thank-you routes", () => {
    window.history.pushState({}, "", "/thank-you");

    render(<App />);

    expect(screen.getByText("Thank you route shell")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("data-route", "thank-you");
  });
});
