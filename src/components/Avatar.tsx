import { useState } from "react";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A profile avatar: renders the user's real photo when one exists (and loads),
 * otherwise their initials on their accent color. Never a random emoji.
 */
export default function Avatar({
  name,
  color,
  avatar,
  className = "friend-avatar",
}: {
  name: string;
  color: string;
  avatar?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={className} style={{ background: `${color}22`, color }}>
      <span className="avatar-initials">{initialsOf(name)}</span>
      {avatar && !failed && (
        <img src={avatar} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
    </span>
  );
}
