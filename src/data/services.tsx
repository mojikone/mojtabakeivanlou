import type { ReactElement } from "react";

export type Service = {
  title: string;
  description: string;
  icon: ReactElement;
};

export const services: Service[] = [
  {
    title: "Flood Modelling & Protection",
    description:
      "1D/2D hydraulic modelling, flood hazard & risk mapping, masterplanning of protection schemes at national scale.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5s2.5 2 5 2 2.5-2 5-2 2.5 2 2.5 2" />
        <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 2.5 2" />
        <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 2.5 2" />
      </svg>
    )
  },
  {
    title: "Road & Drainage Design",
    description:
      "Hydraulic design of road drainage structures, culverts, bridges, and channels along major infrastructure corridors.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l4-14h10l4 14" />
        <path d="M3 17h18" />
        <path d="M10 8h4" />
        <path d="M10.5 12h3" />
      </svg>
    )
  },
  {
    title: "Hydrology & Climate Analysis",
    description:
      "Rainfall-runoff modelling, frequency analysis, and hydrological studies incorporating climate change impact assessment.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 17.6A5 5 0 0 0 18 8h-1.3A8 8 0 1 0 4 16" />
        <line x1="8" y1="19" x2="8" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <line x1="16" y1="19" x2="16" y2="21" />
      </svg>
    )
  },
  {
    title: "Dam Engineering",
    description:
      "Spillway hydraulic design, dam breach analysis, dam safety assessment under FEMA guidelines, and site selection studies.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <line x1="2" y1="8" x2="9" y2="8" />
        <polygon points="9,6 11,6 15,20 7,20" />
        <line x1="4" y1="20" x2="20" y2="20" />
      </svg>
    )
  },
  {
    title: "Stormwater & Sewage Networks",
    description:
      "Gravity network design, urban drainage masterplanning, and network modelling using SewerGEMS and InfoWorks ICM.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    )
  },
  {
    title: "Water Supply & Irrigation",
    description:
      "Urban and rural water supply networks, pressurised irrigation systems, and transmission pipelines with transient analysis.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
      </svg>
    )
  },
  {
    title: "GIS & Spatial Analysis",
    description:
      "Advanced QGIS and ArcGIS workflows, geospatial data pipelines, flood hazard mapping, and drone-based photogrammetry.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    )
  },
  {
    title: "Surveying & Mapping",
    description:
      "Total station (Leica), GNSS, UAV drone mapping, and photogrammetry for engineering survey and geospatial data collection.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
      </svg>
    )
  },
  {
    title: "Engineering Automation",
    description:
      "Python-based automation of HEC-RAS workflows, HDF5 data processing, geospatial pipelines, and AI-augmented delivery.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    )
  }
];
