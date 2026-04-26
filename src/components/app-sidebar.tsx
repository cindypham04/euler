import Link from "next/link";
import { listProblems } from "@/lib/problems";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const ROMAN = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
  "XVII",
  "XVIII",
  "XIX",
  "XX",
];

function ordinal(i: number): string {
  return i < ROMAN.length ? ROMAN[i] : String(i + 1);
}

export async function AppSidebar() {
  const problems = await listProblems();
  return (
    <Sidebar>
      <SidebarHeader className="px-3 pt-3">
        <Link
          href="/"
          className="group/new flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-accent"
        >
          <span className="font-display italic text-base">New problem</span>
          <span className="text-primary transition-transform group-hover/new:translate-x-0.5">
            &rarr;
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="editorial-rule mt-2 mb-1 editorial-label">
            Contents
          </SidebarGroupLabel>
          {problems.length === 0 ? (
            <p
              className="px-2 py-3 font-display italic text-sm text-muted-foreground"
              style={{ fontVariationSettings: "'opsz' 14" }}
            >
              No entries yet.
            </p>
          ) : (
            <SidebarMenu>
              {problems.map((p, i) => {
                const id = p._id.toHexString();
                return (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      render={<Link href={`/problems/${id}`} />}
                      tooltip={p.title}
                      className="group/entry relative h-auto items-baseline gap-3 py-1.5"
                    >
                      <span className="w-9 shrink-0 text-right editorial-label tabular-nums leading-none transition-opacity group-hover/entry:opacity-0">
                        {ordinal(i)}
                      </span>
                      <span
                        aria-hidden
                        className="absolute left-3 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-primary opacity-0 transition-opacity group-hover/entry:opacity-100"
                      />
                      <span className="truncate font-display text-[0.95rem] leading-snug">
                        {p.title}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
