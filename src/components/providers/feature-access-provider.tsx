"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { api, type FeatureAccessResponse } from "@/lib/api/client";
import type { FeatureAccess } from "@/lib/auth/feature-access";

import { useSession } from "./session-provider";

type FeatureAccessContextValue = FeatureAccessResponse & {
  loading: boolean;
};

type FeatureAccessState = {
  token: string;
  value: FeatureAccessContextValue;
};

const DENIED_ACCESS: FeatureAccess = {
  liveEbayPublish: false,
  ebayDelist: false,
  paidComps: false,
  etsyConnect: false,
  etsyPublish: false,
  etsyDelist: false,
  etsyOrders: false,
};

const SAFE_COPY: FeatureAccessResponse["copy"] = {
  liveEbayPublish:
    "Live eBay publishing is currently enabled for selected alpha accounts.",
  ebayDelist:
    "Live eBay delisting is currently enabled for selected alpha accounts.",
  paidComps:
    "Fresh sold comps are currently enabled for selected alpha accounts.",
  etsyConnect:
    "Connecting an Etsy shop is currently enabled for selected alpha accounts.",
  etsyPublish:
    "Live Etsy publishing is currently enabled for selected alpha accounts.",
  etsyDelist:
    "Live Etsy delisting is currently enabled for selected alpha accounts.",
  etsyOrders:
    "Etsy order sync is currently enabled for selected alpha accounts.",
};

function failClosed(loading: boolean): FeatureAccessContextValue {
  return {
    loading,
    access: DENIED_ACCESS,
    copy: SAFE_COPY,
  };
}

const FeatureAccessContext = createContext<FeatureAccessContextValue | null>(null);

export function useFeatureAccess(): FeatureAccessContextValue {
  const context = useContext(FeatureAccessContext);
  if (!context) {
    throw new Error("useFeatureAccess must be used within FeatureAccessProvider");
  }
  return context;
}

export function FeatureAccessProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { token } = useSession();
  const [state, setState] = useState<FeatureAccessState>(() => ({
    token,
    value: failClosed(true),
  }));
  const value = state.token === token ? state.value : failClosed(true);

  useEffect(() => {
    let active = true;

    api.getFeatureAccess(token)
      .then((response) => {
        if (active) {
          setState({ token, value: { loading: false, ...response } });
        }
      })
      .catch(() => {
        if (active) {
          setState({ token, value: failClosed(false) });
        }
      });

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <FeatureAccessContext.Provider value={value}>
      {children}
    </FeatureAccessContext.Provider>
  );
}
