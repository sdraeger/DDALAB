import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  createHttpLink,
  from,
} from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { getSession } from "next-auth/react";

// Create the http link
const httpLink = createHttpLink({
  uri: "/graphql",
});

const authLink = setContext(async (_, { headers }) => {
  const session = await getSession();
  const token = session?.accessToken;
  console.log("Apollo - Sending token:", token);
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : "",
    },
  };
});

// Enhanced cache configuration for plot data
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        // Cache EDF data with smart key generation
        getEdfData: {
          keyArgs: ["filename", "chunkStart", "chunkSize", "preprocessingOptions"],
        },
        // Cache annotations separately
        getAnnotations: {
          keyArgs: ["filePath"],
        },
        // Cache heatmap data
        getDdaHeatmapData: {
          keyArgs: ["filePath", "taskId"],
        },
      },
    },
    // Define cache behavior for EDF data type
    EdfData: {
      keyFields: ["filename", "chunkStart", "chunkSize"],
    },
  },
  // Enable result caching for better performance
  resultCaching: true,
});

export const apolloClient = new ApolloClient({
  link: from([authLink, httpLink]),
  cache,
  defaultOptions: {
    // Enable caching by default, but allow overrides
    watchQuery: { 
      fetchPolicy: "cache-first", 
      errorPolicy: "all" 
    },
    query: { 
      fetchPolicy: "cache-first", 
      errorPolicy: "all" 
    },
    mutate: { 
      errorPolicy: "all" 
    },
  },
});

// Export cache instance for direct manipulation if needed
export { cache as apolloCache };
