import "./styles/tokens.css";
import "./styles/global.css";
import { useEffect } from "react";
import { About } from "./components/About";
import { ContactCTA } from "./components/ContactCTA";
import { ContactPage } from "./components/ContactPage";
import { Experience } from "./components/Experience";
import { Hero } from "./components/Hero";
import { PillNav } from "./components/PillNav";
import { Services } from "./components/Services";
import { Skills } from "./components/Skills";
import { StructuredData } from "./components/StructuredData";
import { ThankYouPage } from "./components/ThankYouPage";

export function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (!sections.length) return;

    if (!("IntersectionObserver" in window)) {
      sections.forEach((section) => section.classList.add("in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [path]);

  if (path === "/contact" || path === "/contact.html") {
    return (
      <>
        <StructuredData />
        <ContactPage />
      </>
    );
  }

  if (path === "/thank-you" || path === "/thank-you.html") {
    return (
      <>
        <StructuredData />
        <ThankYouPage />
      </>
    );
  }

  return (
    <>
      <StructuredData />
      <main data-route="home">
        <PillNav />
        <Hero />
        <Services />
        <About />
        <Experience />
        <Skills />
        <ContactCTA />
      </main>
    </>
  );
}
