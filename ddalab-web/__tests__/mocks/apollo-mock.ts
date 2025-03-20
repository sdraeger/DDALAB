import { MockedProvider } from "@apollo/client/testing";
import { ApolloClient, InMemoryCache } from "@apollo/client";

export const createMockClient = () => {
  return new ApolloClient({
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: {
        fetchPolicy: "no-cache",
        errorPolicy: "all",
      },
      query: {
        fetchPolicy: "no-cache",
        errorPolicy: "all",
      },
    },
  });
};
