import Link from "next/link";

export default function AppNav({ active }: { active: "portfolio" | "futures" }) {
  return (
    <nav className="main-nav" aria-label="Primary">
      <Link className={`main-nav-link${active === "portfolio" ? " active" : ""}`} href="/">
        PORTFOLIO
      </Link>
      <Link className={`main-nav-link${active === "futures" ? " active" : ""}`} href="/futures">
        FUTURES <span>PAPER</span>
      </Link>
    </nav>
  );
}
