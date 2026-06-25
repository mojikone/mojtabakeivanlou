import { education, profile, stats } from "../data/profile";
import { text } from "./text";

export function About() {
  return (
    <section className="section about reveal" id="about">
      <div className="about-copy">
        <p className="eyebrow">About</p>
        <h2 className="section-title">Water systems, translated into certainty.</h2>
        {profile.biography.map((paragraph) => (
          <p key={paragraph}>{text(paragraph)}</p>
        ))}
        <div className="about-stats">
          {stats.map((item) => (
            <span key={item.label}>
              <strong>{item.value}</strong>
              {item.label}
            </span>
          ))}
        </div>
        <div className="education-list">
          {education.map((item) => (
            <article key={item.degree}>
              <strong>{text(item.degree)}</strong>
              <span>{item.school}</span>
              <em>{item.year}</em>
            </article>
          ))}
        </div>
      </div>
      <div className="about-artwork">
        <img src="/assets/img/hydraulic-illustration.webp" alt="Hydraulic engineering line artwork" />
      </div>
    </section>
  );
}
