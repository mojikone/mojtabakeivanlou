import { skills } from "../data/profile";

export function Skills() {
  return (
    <section className="section skills reveal" id="skills">
      <div className="section-heading">
        <p>Technical Toolkit</p>
        <h2 className="section-title">Skills & Software</h2>
      </div>
      <div className="skills-grid">
        {skills.map((group) => (
          <article key={group.title}>
            <h3>{group.title}</h3>
            <div>
              {group.items.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
