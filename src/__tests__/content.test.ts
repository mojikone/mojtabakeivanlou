import { describe, expect, it } from "vitest";
import { profile, skills, education } from "../data/profile";
import { services } from "../data/services";
import { experience } from "../data/experience";

describe("site content", () => {
  it("contains Mojtaba's core profile and contact details", () => {
    expect(profile.name).toBe("Mojtaba Keivanlou");
    expect(profile.email).toBe("keyvanlu.m@gmail.com");
    expect(profile.phoneDisplay).toBe("+968 9297 0635");
    expect(profile.location).toBe("Muscat, Oman");
  });

  it("keeps the nine selected service icons and labels", () => {
    expect(services.map((service) => service.title)).toEqual([
      "Flood Modelling & Protection",
      "Road & Drainage Design",
      "Hydrology & Climate Analysis",
      "Dam Engineering",
      "Stormwater & Sewage Networks",
      "Water Supply & Irrigation",
      "GIS & Spatial Analysis",
      "Surveying & Mapping",
      "Engineering Automation"
    ]);
  });

  it("keeps detailed career and technical content", () => {
    expect(experience[0].company).toBe("Renardet S.A. & Partners");
    expect(experience[0].projects[0].name).toContain("Batinah Flood Protection");
    expect(skills.some((group) => group.items.includes("HEC-RAS 1D/2D"))).toBe(true);
    expect(education).toHaveLength(2);
  });
});
