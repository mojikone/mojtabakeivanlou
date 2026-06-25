import "./styles/tokens.css";
import "./styles/global.css";

export function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";

  if (path === "/contact" || path === "/contact.html") {
    return <main data-route="contact">Contact route shell</main>;
  }

  if (path === "/thank-you" || path === "/thank-you.html") {
    return <main data-route="thank-you">Thank you route shell</main>;
  }

  return <main data-route="home">Home route shell</main>;
}
