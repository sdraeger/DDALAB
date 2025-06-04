import React from "react";
import { useMachine } from "@xstate/react";
import { siteNavigationMachine } from "../machines/site-navigation-machine";
import { SiteNavigationContext } from "./SiteNavigationContext";

interface SiteNavigationProviderProps {
  children: React.ReactNode;
}

export const SiteNavigationProvider: React.FC<SiteNavigationProviderProps> = ({
  children,
}) => {
  const [state, send] = useMachine(siteNavigationMachine);

  return (
    <SiteNavigationContext.Provider value={{ state, send }}>
      {children}
    </SiteNavigationContext.Provider>
  );
};
