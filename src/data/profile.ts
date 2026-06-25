export type Profile = {
  name: string;
  title: string;
  subtitle: string;
  tagline: string;
  email: string;
  phoneDisplay: string;
  phoneHref: string;
  whatsappHref: string;
  linkedinHref: string;
  location: string;
  cvHref: string;
  website: string;
  biography: string[];
  languages: { name: string; proficiency: string }[];
};

export type Stat = {
  value: string;
  label: string;
};

export type EducationItem = {
  degree: string;
  school: string;
  year: string;
};

export type SkillGroup = {
  title: string;
  items: string[];
};

export type ContactForm = {
  pageTitle: string;
  pageIntro: string;
  formIntro: string;
  serviceOptions: string[];
  availability: string[];
  cvCardTitle: string;
  cvCardSubtitle: string;
};

export const profile = {
  name: "Mojtaba Keivanlou",
  title: "Principal Hydraulic & Water Resources Engineer",
  subtitle: "Team Leader",
  tagline: "Turning complex water systems into engineered certainty",
  email: "keyvanlu.m@gmail.com",
  phoneDisplay: "+968 9297 0635",
  phoneHref: "tel:+96892970635",
  whatsappHref: "https://wa.me/96892970635",
  linkedinHref: "https://linkedin.com/in/MojtabaKeivanlou",
  location: "Muscat, Oman",
  cvHref: "/pdf/CV_Mojtaba_Keivanlou_2026.pdf",
  website: "mojtabakeivanlou.com",
  biography: [
    "I am a Senior Hydraulic and Water Resources Engineer with 16 years of international experience across Iran, Oman, and the United States. Currently serving as Team Leader on one of Oman's largest ongoing flood protection programmes — covering the North and South Al Batinah Governorates (15,000 km²) for the Ministry of Agriculture, Fisheries & Water Resources.",
    "I specialise in flood modelling and protection, climate adaptation, dam and spillway design, stormwater master planning, irrigation, water supply, and transient analysis — with a project record spanning national-scale flood risk programmes, US-regulated dam safety assessment, and multi-province flood hazard mapping across Iran, Oman, and the United States.",
    "What distinguishes me is a combination rarely found at this seniority: deep hydraulic engineering paired with modern computational practice — automation of engineering workflows, spatial data pipelines, and AI-augmented project delivery."
  ],
  languages: [
    { name: "Persian", proficiency: "Native" },
    { name: "English", proficiency: "Fluent" }
  ]
} as const satisfies Profile;

export const stats: Stat[] = [
  { value: "16+", label: "Years Experience" },
  { value: "3", label: "Countries" },
  { value: "50+", label: "Projects" }
];

export const education: EducationItem[] = [
  {
    degree: "MSc — Hydraulic Structures Engineering",
    school: "Sari University of Agricultural Sciences and Natural Resources (SANRU), Iran",
    year: "2013"
  },
  {
    degree: "BSc — Water Sciences and Engineering",
    school: "University of Birjand, Iran",
    year: "2009"
  }
];

export const skills: SkillGroup[] = [
  {
    title: "Hydraulic & Hydrological Modelling",
    items: [
      "HEC-RAS 1D/2D",
      "HEC-HMS",
      "SewerGEMS",
      "InfoDrainage",
      "HY-8",
      "HEC-SSP",
      "InfoWorks ICM",
      "WaterGEMS",
      "Hammer",
      "Flow 3D",
      "InfoWater",
      "OpenFOAM / ParaView",
      "Delft3D"
    ]
  },
  {
    title: "GIS & Spatial Analysis",
    items: [
      "QGIS (Advanced)",
      "ArcGIS / ArcGIS Pro",
      "Global Mapper",
      "Google Earth Engine",
      "PostGIS",
      "QGIS Python Plugins"
    ]
  },
  {
    title: "Programming & Automation",
    items: [
      "Python (Geospatial)",
      "HEC-RAS Automation",
      "HDF5",
      "VBA",
      "R",
      "PostgreSQL",
      "Jython",
      "C#",
      "MATLAB",
      "SPSS"
    ]
  },
  {
    title: "CAD & Design",
    items: [
      "AutoCAD",
      "Civil 3D",
      "Storm & Sanitary Analysis",
      "Subassembly Composer",
      "Infraworks"
    ]
  },
  {
    title: "Survey & Field",
    items: [
      "Total Station (Leica)",
      "GNSS / GPS",
      "UAV / Drone Mapping",
      "Photogrammetry"
    ]
  },
  {
    title: "Data & Dev Tools",
    items: [
      "MS Office 365",
      "Docker",
      "GitHub",
      "Power BI",
      "AI Engineering Workflows",
      "MS Project",
      "SAP2000",
      "ETABS",
      "GEO5"
    ]
  }
];

export const contactForm: ContactForm = {
  pageTitle: "Start a Project",
  pageIntro:
    "Based in Muscat, Oman — available for consultancy, design review, hydraulic modelling, and international project collaboration. Fill in the form and I'll be in touch within one working day.",
  formIntro:
    "Please provide as much detail as you can — project type, location, scope, and any deadlines will help me give you a useful first response.",
  serviceOptions: [
    "Flood Protection and Hazard Mapping",
    "Road Drainage (Channels / Culverts / Bridges)",
    "Hydrological Analysis & Climate Change Impact",
    "Dam Engineering (Spillway Design / Breach Analysis)",
    "Stormwater / Sewage Network Design",
    "Water Supply (Urban / Rural)",
    "Irrigation (Landscape / Agriculture)",
    "GIS & Spatial Analysis",
    "Surveying (Land / Drone)",
    "Engineering Automation / Python",
    "Design Review / Consultancy"
  ],
  availability: [
    "Available for consultancy, design review, hydraulic modelling, and international project collaboration.",
    "Based in Muscat — working worldwide."
  ],
  cvCardTitle: "Curriculum Vitae",
  cvCardSubtitle: "Full detailed CV including project list and software experience."
};
