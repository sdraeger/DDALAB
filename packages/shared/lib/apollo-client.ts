import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  createHttpLink,
} from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { onError } from "@apollo/client/link/error";
import { getSession } from "next-auth/react";

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

// Create the Apollo Client
// export const apolloClient = new ApolloClient({
//   link: from([errorLink, authLink, httpLink]),
//   cache: new InMemoryCache({
//     typePolicies: {
//       Query: {
//         fields: {
//           getAnnotations: {
//             merge(existing, incoming) {
//               return incoming; // Always prefer incoming data
//             },
//           },
//         },
//       },
//       AnnotationType: {
//         keyFields: ["id"],
//         fields: {
//           id: {
//             read(id) {
//               // Make sure IDs are read as numbers
//               return typeof id === "string" ? parseInt(id, 10) : id;
//             },
//           },
//         },
//       },
//     },
//   }),
//   defaultOptions: {
//     watchQuery: {
//       fetchPolicy: "network-only",
//       errorPolicy: "all",
//     },
//     query: {
//       fetchPolicy: "network-only",
//       errorPolicy: "all",
//     },
//     mutate: {
//       errorPolicy: "all",
//     },
//   },
// });

export const apolloClient = new ApolloClient({
  link: ApolloLink.from([authLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: { fetchPolicy: "no-cache", errorPolicy: "all" },
    query: { fetchPolicy: "no-cache", errorPolicy: "all" },
    mutate: { errorPolicy: "all" },
  },
});
