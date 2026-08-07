import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CredentialItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  year?: number | null;
  href?: string | null;
  hrefLabel?: string;
};

/**
 * Generic "title + dated credential list" section, reused for
 * qualifications, publications, books, and media appearances — each of
 * which is a differently-shaped table mapped down to CredentialItem by the
 * page. Renders nothing when there are no items, so a future custom
 * doctor page can pass an empty array for a section it doesn't use without
 * leaving a blank heading behind.
 */
export function InfoListSection({ title, items }: { title: string; items: CredentialItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section>
      <h2 className="font-heading text-xl font-medium">{title}</h2>
      <ul className="mt-4 space-y-4">
        {items.map((item) => {
          const meta = [item.subtitle, item.year].filter(Boolean).join(" · ");

          return (
            <li key={item.id} className="border-accent/40 border-s-2 ps-4">
              <p className="text-foreground font-medium">{item.title}</p>
              {meta ? <p className="text-muted-foreground mt-0.5 text-sm">{meta}</p> : null}
              {item.href ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "link", size: "sm" }), "mt-1 h-auto p-0")}
                >
                  {item.hrefLabel}
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
