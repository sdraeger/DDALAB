"use client"

import type React from "react"

import { ApolloProvider } from "@apollo/client"
import { apolloClient } from "@/lib/apollo-client"

export function ApolloWrapper({ children }: { children: React.ReactNode }) {
  return <ApolloProvider client={apolloClient}>{children}</ApolloProvider>
}

