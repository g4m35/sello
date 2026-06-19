import { SessionProvider } from "@/components/providers/session-provider";
import { FeatureAccessProvider } from "@/components/providers/feature-access-provider";
import { Sidebar } from "@/components/app/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <FeatureAccessProvider>
        <div className="app">
          <Sidebar />
          <div className="main">{children}</div>
        </div>
      </FeatureAccessProvider>
    </SessionProvider>
  );
}
