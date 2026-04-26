import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="relative flex h-14 shrink-0 items-center gap-3 px-5">
          <SidebarTrigger />
          <div className="flex items-baseline gap-2">
            <span
              className="font-display text-xl italic"
              style={{ letterSpacing: "-0.01em" }}
            >
              euler
            </span>
            <span className="hidden text-[0.7rem] italic text-muted-foreground sm:inline">
              · unblind the genius math in you
            </span>
          </div>
          <div className="ml-auto editorial-label">No. 01</div>
          <div
            aria-hidden
            className="absolute inset-x-5 bottom-0 h-px bg-foreground/15"
          />
        </header>
        <div className="flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
