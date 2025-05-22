import { createContext } from "react";
import { dockerMachine } from "../machines/docker-machine";

export const DockerContext = createContext<{
  state: any;
  send: any;
}>({
  state: dockerMachine.initialState,
  send: () => {},
});
