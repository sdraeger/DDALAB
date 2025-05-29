"use client";

import { ApolloProvider } from "@apollo/client";
import { apolloClient } from "../../lib/utils/apollo-client";

export function ApolloWrapper({ children }: { children: any }) {
  return <ApolloProvider client={apolloClient}>{children}</ApolloProvider>;
}
