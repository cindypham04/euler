import Link from "next/link";
import { Plus } from "lucide-react";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function AppSidebar() {
  const problems = await listProblems();
  return (
    <Sidebar>
      <SidebarHeader>
        <Link
          href="/"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "justify-start gap-2",
          )}
        >
          <Plus className="h-4 w-4" />
          New problem
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Problems</SidebarGroupLabel>
          {problems.length === 0 ? (
            <p className="px-2 py-1 text-sm text-muted-foreground">
              No problems yet.
            </p>
          ) : (
            <SidebarMenu>
              {problems.map((p) => {
                const id = p._id.toHexString();
                return (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      render={<Link href={`/problems/${id}`} />}
                      tooltip={p.title}
                    >
                      <span className="truncate">{p.title}</span>
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
