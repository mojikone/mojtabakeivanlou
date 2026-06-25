import { profile } from "../data/profile";

export function ContactCTA() {
  return (
    <section className="section contact-cta reveal" id="contact">
      <p className="eyebrow">Contact</p>
      <h2>
        Let's work <span>together</span>
      </h2>
      <p>Available for consultancy, design review, hydraulic modelling, and international project collaboration.</p>
      <div className="contact-links">
        <a href={`mailto:${profile.email}`}>{profile.email}</a>
        <a href={profile.phoneHref}>{profile.phoneDisplay}</a>
        <a href={profile.whatsappHref}>WhatsApp</a>
        <a href={profile.linkedinHref}>LinkedIn</a>
        <a href={profile.cvHref}>Download CV</a>
      </div>
    </section>
  );
}
