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

    expect(screen.getByRole("main")).toHaveAttribute("data-route", "contact");
    expect(screen.getByRole("form", { name: "Project enquiry" })).toHaveAttribute(
      "action",
      "https://api.web3forms.com/submit"
    );
    expect(screen.getByRole("form", { name: "Project enquiry" })).toHaveAttribute("method", "POST");
    expect(screen.getByDisplayValue("48578b9d-2262-418b-a5b9-4d9bd167ffb4")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://mojtabakeivanlou.com/thank-you.html")).toBeInTheDocument();
  });

  it("renders the thank-you route shell for the thank-you routes", () => {
    window.history.pushState({}, "", "/thank-you");

    render(<App />);

    expect(screen.getByRole("main")).toHaveAttribute("data-route", "thank-you");
    expect(screen.getByText("Enquiry Received")).toBeInTheDocument();
  });
});
