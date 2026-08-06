import type { ReactNode } from "react";

// Deliberately not wrapped by the (dashboard) layout or its auth guard —
// /login must remain reachable when there is no session (see the project
// plan, correction §2).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="flex-1">{children}</main>;
}
