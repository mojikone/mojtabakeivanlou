import { profile } from "../data/profile";

export function ThankYouPage() {
  return (
    <main className="thank-you-page" data-route="thank-you">
      <section className="thank-you-card">
        <div className="check-mark" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="eyebrow">Mojtaba Keivanlou / Hydraulic Engineering</p>
        <h1>Enquiry Received</h1>
        <p>Thank you for reaching out. I have received your project enquiry and will review the details carefully.</p>
        <p>I aim to respond within one working day. You can also connect on LinkedIn or send a direct WhatsApp message.</p>
        <div className="thank-you-links">
          <a href="/">Back to Home</a>
          <a href="/contact.html">Send Another</a>
          <a href={profile.cvHref}>Download CV</a>
        </div>
        <div className="direct-links">
          <a href={profile.phoneHref}>Call</a>
          <a href={profile.whatsappHref}>WhatsApp</a>
          <a href={profile.linkedinHref}>LinkedIn</a>
          <a href={`mailto:${profile.email}`}>Email</a>
        </div>
      </section>
    </main>
  );
}
