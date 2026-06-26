import "./styles/tokens.css";
import "./styles/global.css";
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
