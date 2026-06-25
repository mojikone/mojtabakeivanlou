import { services } from "../data/services";

export function Services() {
  return (
    <section className="section services reveal" id="services">
      <div className="section-heading">
        <p>What I Do</p>
        <h2 className="section-title">Engineering Services</h2>
      </div>
      <div className="service-grid">
        {services.map((service) => (
          <article className="service-item" key={service.title}>
            <span className="service-icon">{service.icon}</span>
            <h3>{service.title}</h3>
            <p>{service.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
