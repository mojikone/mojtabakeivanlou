export type ExperienceProject = {
  name: string;
  period: string;
  role: string;
  scope?: string;
  bullets: string[];
};

export type ExperienceEntry = {
  company: string;
  period: string;
  role: string;
  location: string;
  summary: string;
  projects: ExperienceProject[];
};

export const experience: ExperienceEntry[] = [
  {
    company: "Renardet S.A. & Partners",
    period: "2022 – Present",
    role: "Senior Hydraulic Engineer · Team Leader",
    location: "Muscat, Sultanate of Oman",
    summary:
      "Leading the hydraulic team on one of Oman's largest ongoing flood protection programmes. Currently Team Leader on the Batinah Flood Protection Master Plan (15,000 km², OMR 6M / ~USD 15.6M) for the Ministry of Agriculture, Fisheries & Water Resources, with parallel project delivery across Dhofar Governorate and major road infrastructure corridors.",
    projects: [
      {
        name: "Batinah Flood Protection Scheme — North & South Al Batinah Governorates",
        period: "Feb 2023 – Present",
        role: "Team Leader",
        scope: "OMR 6M (~USD 15.6M) · 15,000 km² study area",
        bullets: [
          "Leading all technical aspects: hydrology studies, hydraulic modelling, flood risk mapping",
          "Dam site selection; design of dam hydraulic structures and spillway modelling (Flow 3D)",
          "Integrated HEC-HMS / HEC-RAS / Python model; SewerGEMS & InfoDrainage for channel design",
          "Client and stakeholder management, report writing and reviewing",
          "Flood mapping under existing and proposed conditions for insurance and cost-benefit analysis"
        ]
      },
      {
        name: "Majlas Dam Design Review — Quriyat",
        period: "Mar 2026 – Present",
        role: "Hydrology & Hydraulic Engineer",
        bullets: [
          "Review and update of hydrology report; revised rainfall and design flow values",
          "Flood protection channel design downstream of dam in Quriyat"
        ]
      },
      {
        name: "Detailed Design of Flood Protection Schemes — Dhofar Governorate",
        period: "Aug 2022 – Present",
        role: "Hydraulic Engineer",
        scope: "Wilayat Salalah, Taqah, Mirbat, Rakhyoot & Dhalkoot",
        bullets: [
          "Hydrology studies and hydraulic modelling",
          "Dam site selection and dam break analysis",
          "Hydraulic strategy and meeting coordination"
        ]
      },
      {
        name: "Upgrading of Existing Batinah Dual Carriageway",
        period: "Jan 2022 – Mar 2023",
        role: "Hydraulic Engineer",
        scope: "230 km road corridor",
        bullets: ["Comprehensive hydrology analysis and design of road drainage structures"]
      },
      {
        name: "Dualisation of Al Ansab Street — Consultancy Services",
        period: "Feb 2022 – Aug 2022",
        role: "Hydraulic Engineer",
        bullets: ["Road drainage design, H&H studies, supervising and delivering drawings"]
      },
      {
        name: "Design of Internal Roads — Sohar Municipality",
        period: "Jul 2022 – Sep 2022",
        role: "Hydraulic Engineer",
        bullets: ["Road drainage design and H&H studies"]
      },
      {
        name: "Yankit Mixed Use Development",
        period: "Sep 2022 – Present",
        role: "Hydraulic Engineer",
        bullets: ["Design of road drainage, stormwater system and sewage network"]
      },
      {
        name: "Development of Hayour Cave Dhofar Resort",
        period: "May 2022 – Aug 2022",
        role: "Hydraulic Engineer",
        bullets: ["Hydrology studies, road drainage, stormwater and sewage system design"]
      },
      {
        name: "Al Bandar Mixed Use Development",
        period: "Feb 2022 – Mar 2022",
        role: "Hydraulic Engineer",
        bullets: ["Drainage system revision, stormwater design, sewage system review"]
      },
      {
        name: "Road Connecting MAM Camp to Muscat Expressway",
        period: "Feb 2022 – Mar 2022",
        role: "Hydraulic Engineer",
        bullets: ["Road drainage design"]
      },
      {
        name: "Dima Lima Khasab Road",
        period: "Sep 2022 – Present",
        role: "Hydraulic Engineer",
        bullets: ["Road drainage design"]
      }
    ]
  },
  {
    company: "DuBois & King",
    period: "2021",
    role: "Senior Hydraulic Engineer — Freelance Specialist",
    location: "Vermont, USA (Remote)",
    summary:
      "Dam safety assessment for Shadow Lake Dam under US federal and Vermont ANR standards. Comprehensive hydrology, dam breach modelling, and hazard classification per FEMA guidelines — delivered remotely as an independent specialist.",
    projects: [
      {
        name: "Shadow Lake Dam Safety Assessment — Glover, VT",
        period: "Jan 2021 – Nov 2021",
        role: "Hydraulic Engineer",
        bullets: [
          "Comprehensive hydrology analysis and hydraulic design of dam",
          "Dam breach analysis and hazard classification per FEMA guidelines",
          "Delivered under US federal and Vermont ANR regulatory requirements"
        ]
      }
    ]
  },
  {
    company: "Sazeh Pardazi Iran",
    period: "2020 – 2021",
    role: "Water Resources Engineer — Drainage & Water Supply",
    location: "Tehran, Iran",
    summary:
      "Flood hazard and risk mapping across three major Iranian provinces (409 km of river systems), river training and flood protection design, and water infrastructure projects including transmission pipelines and stormwater masterplanning.",
    projects: [
      {
        name: "Flood Hazard & Risk Mapping — Hormozgan Province Rivers",
        period: "Jan 2020 – Sep 2020",
        role: "Hydraulic Engineer",
        scope: "127 km of river system",
        bullets: ["Hydraulic modelling of the river system for flood hazard and risk mapping"]
      },
      {
        name: "River Training & Rehabilitation — Lorestan Province",
        period: "Aug 2020 – Jan 2021",
        role: "Hydraulic Engineer",
        scope: "190 km of rivers",
        bullets: ["Hydraulic modelling and detailed design of river training works"]
      },
      {
        name: "Flood Protection of Sensitive Areas — Kerman Province",
        period: "Jan 2021 – May 2021",
        role: "Hydraulic Engineer",
        scope: "92 km",
        bullets: ["Hydraulic modelling and detailed design of flood protection structures"]
      },
      {
        name: "Water Transmission Pipeline — Karaj WWTP to Eshtehard Industrial Zone",
        period: "Jun 2021 – Sep 2021",
        role: "Hydraulic Engineer",
        bullets: ["Hydraulic design of the transmission pipeline", "Surge (water hammer) analysis"]
      },
      {
        name: "Water Supply to Rural Areas — Greater Tehran Region",
        period: "Jun 2021 – Sep 2021",
        role: "Hydraulic Engineer",
        bullets: [
          "Hydraulic design of water supply to important rural areas around Tehran",
          "Revision of existing distribution systems"
        ]
      },
      {
        name: "Stormwater Management — Three Regions, Qazvin Province",
        period: "Sep 2021 – Dec 2021",
        role: "Hydraulic Engineer",
        bullets: ["Hydraulic design of gravity channels and pipelines for urban stormwater management"]
      }
    ]
  },
  {
    company: "Hydrotech Toos (HTT)",
    period: "2019 – 2020",
    role: "Senior Hydraulic Engineer — Water Supply & Sewage",
    location: "Mashhad, Iran",
    summary:
      "Senior engineer on water supply, sewage, and irrigation networks for Mashhad metropolitan area's developing zones. Included network optimisation and leakage detection across Khorasan Razavi Province.",
    projects: [
      {
        name: "Revision of Mashhad City's Main Landscape Irrigation Pipelines",
        period: "Jun 2019 – Jan 2020",
        role: "Hydraulic Engineer",
        bullets: ["Revising and modifying main pipelines supplying landscape irrigation across the city"]
      },
      {
        name: "Water Supply — Developing Areas of Mashhad City",
        period: "Jun 2019 – Jan 2020",
        role: "Hydraulic Engineer",
        bullets: ["Hydraulic design of new water supply network for developing urban zones"]
      },
      {
        name: "Sewage System Design — Developing Areas of Mashhad City",
        period: "Jun 2019 – Jan 2020",
        role: "Hydraulic Engineer",
        bullets: ["Hydraulic design of sewage collection network for developing urban zones"]
      },
      {
        name: "Water Distribution Network Modelling — Khorasan Razavi Province",
        period: "Jun 2019 – Jan 2020",
        role: "Hydraulic Engineer",
        bullets: [
          "Hydraulic modelling of existing distribution network across multiple cities",
          "Leakage detection and network optimisation"
        ]
      }
    ]
  },
  {
    company: "Earlier Positions — Iran",
    period: "2010 – 2019",
    role: "Project Manager · Hydraulic Engineer · GIS Technician",
    location: "Multiple Provinces, Iran",
    summary:
      "Progressive nine-year career from GIS/CAD technician to Project Manager — spanning irrigation system design, provincial flood hazard mapping, and leading field teams with Leica instruments across Iran.",
    projects: [
      {
        name: "Majd Ab Shargh — Project Manager (Drainage)",
        period: "Apr 2017 – Jun 2019",
        role: "Project Manager",
        bullets: [
          "Flood hazard and risk mapping — client interaction, team building, hydraulic modelling",
          "Field surveying with Leica total station instruments; detailed design of flood protection structures"
        ]
      },
      {
        name: "Behin Ab Pazh — Hydraulic Engineer (Drainage)",
        period: "Aug 2015 – Mar 2017",
        role: "Hydraulic Engineer",
        bullets: ["Flood hazard and risk mapping — hydrologic analysis and hydraulic modelling of river systems"]
      },
      {
        name: "Zharfab Pay — Hydraulic Engineer (Drainage)",
        period: "Oct 2013 – Jul 2015",
        role: "Hydraulic Engineer",
        bullets: ["Design of pressurised irrigation systems"]
      },
      {
        name: "Abgostaran Sabz Dasht — GIS & CAD Draftsman",
        period: "Oct 2010 – Dec 2013",
        role: "GIS & CAD Technician",
        bullets: [
          "Comprehensive drainage project — east part of Mazandaran Province",
          "Preparing GIS and CAD layouts and engineering drawings"
        ]
      }
    ]
  }
];
