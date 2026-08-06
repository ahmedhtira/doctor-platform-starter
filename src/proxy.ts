import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Locale-routing only. This is a UX convenience, not a security boundary —
// dashboard access control is enforced independently at the layout,
// data-access-layer, and RLS levels (see the project plan, §5).
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
