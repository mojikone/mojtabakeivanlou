import { useState } from "react";
import { experience } from "../data/experience";
import { text } from "./text";

export function Experience() {
  const [open, setOpen] = useState(experience[0]?.company ?? "");

  return (
    <section className="section experience reveal" id="experience">
      <div className="section-heading">
        <p>Career</p>
        <h2 className="section-title">Experience</h2>
      </div>
      <div className="experience-list">
        {experience.map((entry) => {
          const isOpen = open === entry.company;
          return (
            <article className="experience-item" key={entry.company}>
              <button type="button" onClick={() => setOpen(isOpen ? "" : entry.company)} aria-expanded={isOpen}>
                <span>{entry.period}</span>
                <strong>{text(entry.company)}</strong>
              </button>
              <p className="experience-role">{text(entry.role)} / {entry.location}</p>
              <p>{text(entry.summary)}</p>
              {isOpen && (
                <div className="project-list">
                  {entry.projects.slice(0, 4).map((project) => (
                    <article key={project.name}>
                      <h3>{text(project.name)}</h3>
                      <p>{text(project.period)} / {text(project.role)}</p>
                      {project.scope && <p>{text(project.scope)}</p>}
                      <ul>
                        {project.bullets.slice(0, 3).map((bullet) => (
                          <li key={bullet}>{text(bullet)}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
