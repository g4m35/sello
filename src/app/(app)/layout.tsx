import { SessionProvider } from "@/components/providers/session-provider";
import { FeatureAccessProvider } from "@/components/providers/feature-access-provider";
import { MobileNavProvider } from "@/components/providers/mobile-nav-provider";
import { Sidebar } from "@/components/app/sidebar";
import { MobileDrawerOverlay } from "@/components/app/mobile-drawer-overlay";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <FeatureAccessProvider>
        <MobileNavProvider>
          <div className="app">
            <Sidebar />
            <MobileDrawerOverlay />
            <div className="main">{children}</div>
          </div>
        </MobileNavProvider>
      </FeatureAccessProvider>
    </SessionProvider>
  );
}
