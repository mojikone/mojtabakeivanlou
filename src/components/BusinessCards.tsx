import { services } from "../data/services";
import { profile } from "../data/profile";

export function BusinessCards() {
  return (
    <section className="business-cards" aria-labelledby="business-card-title">
      <div className="section-heading">
        <p>Business Card</p>
        <h2 className="section-title" id="business-card-title">
          Contact details, compact.
        </h2>
      </div>
      <div className="business-card-row">
        <article className="biz-card biz-card-front" aria-label="Business card front">
          <span className="biz-accent" />
          <span className="biz-circle biz-circle-one" />
          <span className="biz-circle biz-circle-two" />
          <div className="biz-front-content">
            <div>
              <h3>
                Mojtaba
                <span>Keivanlou</span>
              </h3>
              <p>Hydraulic & Hydrology / Water Resources / Wet Utilities</p>
            </div>
            <div className="biz-contact-lines">
              <span>{profile.phoneDisplay}</span>
              <span>{profile.email}</span>
              <span>{profile.location}</span>
              <span>{profile.website}</span>
            </div>
          </div>
        </article>
        <article className="biz-card biz-card-back" aria-label="Business card back">
          <div className="biz-back-head">
            <span>Services</span>
            <i />
          </div>
          <div className="biz-service-grid">
            {services.slice(0, 9).map((service) => (
              <span key={service.title}>
                {service.icon}
                <em>{service.title.replace(" & ", " / ")}</em>
              </span>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
