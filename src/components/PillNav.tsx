const links = [
  ["Home", "#home"],
  ["Services", "#services"],
  ["About", "#about"],
  ["Experience", "#experience"],
  ["Skills", "#skills"],
  ["Contact", "#contact"]
] as const;

export function PillNav() {
  return (
    <nav className="pill-nav" aria-label="Primary">
      {links.map(([label, href]) => (
        <a key={href} href={href}>
          {label}
        </a>
      ))}
    </nav>
  );
}
