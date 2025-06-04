import React from "react";
import { useMachine } from "@xstate/react";
import { dockerMachine } from "../machines/docker-machine";
import { DockerContext } from "./DockerContext";

interface DockerProviderProps {
  children: React.ReactNode;
}

export const DockerProvider: React.FC<DockerProviderProps> = ({ children }) => {
  const [state, send] = useMachine(dockerMachine);

  return (
    <DockerContext.Provider value={{ state, send }}>
      {children}
    </DockerContext.Provider>
  );
};
