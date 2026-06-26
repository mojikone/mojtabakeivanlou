import { BusinessCards } from "./BusinessCards";
import { contactForm, profile } from "../data/profile";
import { text } from "./text";

export function ContactPage() {
  const omanTime = new Date().toLocaleString("en-GB", { timeZone: "Asia/Muscat" });

  return (
    <main className="contact-page" data-route="contact">
      <section className="contact-hero">
        <a className="route-home" href="/">
          Home
        </a>
        <p className="eyebrow">Project Enquiry</p>
        <h1>{contactForm.pageTitle}</h1>
        <p>{text(contactForm.pageIntro)}</p>
      </section>
      <section className="contact-panel-section">
        <div className="contact-form-panel">
          <p className="eyebrow">Project Enquiry</p>
          <p>{text(contactForm.formIntro)}</p>
          <form method="POST" action="https://api.web3forms.com/submit" aria-label="Project enquiry">
            <input type="hidden" name="access_key" value="48578b9d-2262-418b-a5b9-4d9bd167ffb4" />
            <input type="hidden" name="subject" value="New Project Enquiry - mojtabakeivanlou.com" />
            <input type="hidden" name="redirect" value="https://mojtabakeivanlou.com/thank-you.html" />
            <input type="checkbox" name="botcheck" className="botcheck" tabIndex={-1} aria-hidden="true" />
            <input type="hidden" name="Received (Oman Time)" value={omanTime} readOnly />

            <div className="form-grid">
              <label>
                Full Name
                <input type="text" name="name" required placeholder="Your name" />
              </label>
              <label>
                Email Address
                <input type="email" name="email" required placeholder="your@email.com" />
              </label>
              <label>
                Phone / WhatsApp
                <input type="tel" name="phone" placeholder="+968 XXXX XXXX" />
              </label>
              <label>
                Organisation
                <input type="text" name="organisation" placeholder="Company or institution" />
              </label>
              <label className="full">
                Project Type
                <select name="project-type" required defaultValue="">
                  <option value="" disabled>
                    Select a type...
                  </option>
                  {contactForm.serviceOptions.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="full">
                Project Description
                <textarea
                  name="description"
                  required
                  placeholder="Briefly describe your project, location, scale, scope, and timeline."
                />
              </label>
            </div>
            <button type="submit">Send Enquiry</button>
          </form>
        </div>
        <aside className="contact-side-panel" aria-label="Direct contact">
          <h2>Direct Contact</h2>
          <div className="direct-links">
            <a href={`mailto:${profile.email}`}>{profile.email}</a>
            <a href={profile.phoneHref}>{profile.phoneDisplay}</a>
            <a href={profile.whatsappHref}>WhatsApp</a>
            <a href={profile.linkedinHref}>LinkedIn</a>
          </div>
          <div className="availability-list">
            {contactForm.availability.map((item) => (
              <p key={item}>{text(item)}</p>
            ))}
          </div>
          <a className="cv-link-card" href={profile.cvHref}>
            <strong>{contactForm.cvCardTitle}</strong>
            <span>{contactForm.cvCardSubtitle}</span>
          </a>
        </aside>
      </section>
      <BusinessCards />
    </main>
  );
}
