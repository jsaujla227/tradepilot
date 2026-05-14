import { getUserAndProfile } from "@/lib/profile";
import { Sidebar } from "./_components/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware enforces auth for all (app) routes except /risk and /risk/*.
  // The layout still queries user/profile so /risk can render anonymous-friendly
  // chrome (sidebar with a "Sign in" CTA).
  const session = await getUserAndProfile();
  return (
    <div className="flex flex-1 min-h-0">
      <Sidebar email={session?.email ?? null} />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
