import "./styles/tokens.css";
import "./styles/global.css";
import { About } from "./components/About";
import { ContactCTA } from "./components/ContactCTA";
import { Experience } from "./components/Experience";
import { Hero } from "./components/Hero";
import { PillNav } from "./components/PillNav";
import { Services } from "./components/Services";
import { Skills } from "./components/Skills";

export function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";

  if (path === "/contact" || path === "/contact.html") {
    return <main data-route="contact">Contact route shell</main>;
  }

  if (path === "/thank-you" || path === "/thank-you.html") {
    return <main data-route="thank-you">Thank you route shell</main>;
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
