import { createContext } from "react";
import { siteNavigationMachine } from "../machines/site-navigation-machine";

export const SiteNavigationContext = createContext<{
  state: any;
  send: any;
}>({
  state: siteNavigationMachine.initialState,
  send: () => {},
});
