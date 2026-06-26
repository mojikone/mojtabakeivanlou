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
import { ThankYouPage } from "./components/ThankYouPage";

export function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";

  if (path === "/contact" || path === "/contact.html") {
    return <ContactPage />;
  }

  if (path === "/thank-you" || path === "/thank-you.html") {
    return <ThankYouPage />;
  }

  return (
    <main data-route="home">
      <PillNav />
      <Hero />
      <Services />
      <About />
      <Experience />
      <Skills />
      <ContactCTA />
    </main>
  );
}
