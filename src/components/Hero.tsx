import { profile, stats } from "../data/profile";

export function Hero() {
  return (
    <section className="hero" id="home">
      <div className="hero-portrait" aria-hidden="true">
        <img src="/assets/img/mojtaba-hero.png" alt="" />
      </div>
      <div className="hero-content">
        <p className="hero-kicker">{profile.subtitle}</p>
        <h1>Mojtaba Keivanlou</h1>
        <p className="hero-title">{profile.title}</p>
        <p className="hero-tagline">{profile.tagline}</p>
        <div className="hero-actions" aria-label="Primary actions">
          <a href="#contact">Contact</a>
          <a href={profile.cvHref}>Download CV</a>
        </div>
      </div>
      <div className="hero-stats" aria-label="Professional summary">
        {stats.map((item) => (
          <span key={item.label}>
            <strong>{item.value}</strong>
            {item.label}
          </span>
        ))}
      </div>
      <button className="quick-info" type="button">
        Quick info
      </button>
    </section>
  );
}
