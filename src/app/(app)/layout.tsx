import { SessionProvider } from "@/components/providers/session-provider";
import { Sidebar } from "@/components/app/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="app">
        <Sidebar />
        <div className="main">{children}</div>
      </div>
    </SessionProvider>
  );
}
