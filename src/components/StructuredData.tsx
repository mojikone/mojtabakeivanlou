import { education, profile, skills } from "../data/profile";

export function StructuredData() {
  const knowsAbout = Array.from(
    new Set([
      "Hydraulic Engineering",
      "Water Resources Engineering",
      "Flood Modelling",
      "Dam Engineering",
      "HEC-RAS",
      "HEC-HMS",
      "QGIS",
      "Python",
      "GIS",
      ...skills.flatMap((group) => group.items.slice(0, 4))
    ])
  );

  const data = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.name,
    jobTitle: profile.title,
    url: `https://${profile.website}`,
    image: `https://${profile.website}/assets/img/profile.jpeg`,
    email: profile.email,
    telephone: profile.phoneHref.replace("tel:", ""),
    address: {
      "@type": "PostalAddress",
      addressLocality: "Muscat",
      addressCountry: "OM"
    },
    sameAs: [profile.linkedinHref],
    worksFor: {
      "@type": "Organization",
      name: "Renardet S.A. & Partners"
    },
    alumniOf: education.map((item) => ({
      "@type": "EducationalOrganization",
      name: item.school
    })),
    knowsAbout
  };

  return (
    <script
      type="application/ld+json"
      data-testid="person-json-ld"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
