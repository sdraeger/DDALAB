import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  from,
} from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { onError } from "@apollo/client/link/error";
import { getAuthToken } from "./auth";

// Create an error link to handle GraphQL errors
const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, locations, path }) => {
      console.error(
        `[GraphQL error]: Message: ${message}, Location: ${locations}, Path: ${path}`
      );

      // Debug auth errors specifically
      if (message.includes("Authentication required")) {
        const context = operation.getContext();
        const headers = context.headers || {};
        console.error(
          `Auth headers sent:`,
          headers.authorization ? "Token present" : "No token"
        );
      }
    });
  }
  if (networkError) {
    console.error(`[Network error]: ${networkError}`);
  }
});

// Create an HTTP link to our local GraphQL proxy
const httpLink = createHttpLink({
  uri: "/graphql", // Use our local proxy
  credentials: "include", // Always include credentials
  fetchOptions: {
    credentials: "include", // Ensure cookies are sent with every request
  },
});

// Create an auth link to add the token to the headers
const authLink = setContext((_, { headers }) => {
  // Get the authentication token from local storage
  const token = getAuthToken();

  // Log auth status for debugging
  if (!token) {
    console.warn("No auth token available for GraphQL request");
  }

  // Return the headers to the context so httpLink can read them
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : "",
    },
  };
});

// Create the Apollo Client
export const apolloClient = new ApolloClient({
  link: from([errorLink, authLink, httpLink]),
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          getAnnotations: {
            merge(existing, incoming) {
              return incoming; // Always prefer incoming data
            },
          },
        },
      },
      AnnotationType: {
        keyFields: ["id"],
        fields: {
          id: {
            read(id) {
              // Make sure IDs are read as numbers
              return typeof id === "string" ? parseInt(id, 10) : id;
            },
          },
        },
      },
    },
  }),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: "network-only",
      errorPolicy: "all",
    },
    query: {
      fetchPolicy: "network-only",
      errorPolicy: "all",
    },
    mutate: {
      errorPolicy: "all",
    },
  },
});
