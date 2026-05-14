import { getUserAndProfile } from "@/lib/profile";
import { Sidebar } from "./_components/sidebar";
import { MobileNav } from "./_components/mobile-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getUserAndProfile();
  const email = session?.email ?? null;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MobileNav email={email} />
      <div className="flex flex-1 min-h-0">
        <Sidebar email={email} />
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
