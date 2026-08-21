import { AdminApp } from "./AdminApp";
import { DisplayWallApp } from "./DisplayWallApp";
import { GuestApp } from "./GuestApp";
import { HomePage, NotFoundPage, PrivacyPage } from "./StaticPages";

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const displayMatch = path.match(/^\/p\/([A-Za-z0-9_-]+)\/display$/);
  const partyMatch = path.match(/^\/p\/([A-Za-z0-9_-]+)$/);
  if (displayMatch) return <DisplayWallApp code={displayMatch[1]} />;
  if (partyMatch) return <GuestApp code={partyMatch[1]} />;
  if (path === "/admin") return <AdminApp />;
  if (path === "/datenschutz") return <PrivacyPage />;
  if (path === "/") return <HomePage />;
  return <NotFoundPage />;
}
