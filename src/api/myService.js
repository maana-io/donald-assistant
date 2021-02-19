import { CREATE_LAMBDAS, LIST_LAMBDAS } from "./graphqlQueries";

import AssistantAPIClient from "@io-maana/q-assistant-client";

const LAMBDA_SERVICE_ID =
  window.MAANA_ENV.LAMBDA_SERVICE_ID || "io.maana.lambda-server";

export async function getLambdaServiceBaseUrl() {
  if (!LAMBDA_SERVICE_ID) {
    throw new Error("Lambda Service ID missing in environment.");
  }

  const service = await AssistantAPIClient.getServiceById(LAMBDA_SERVICE_ID);
  if (!service) {
    throw new Error("The Lambda Service is missing.");
  }

  const endpointUrl = service.location.url;
  return endpointUrl.replace("graphql", "");
}

const client = {
  query: async ({ query, variables }) => {
    return await AssistantAPIClient.executeGraphql({
      serviceId: LAMBDA_SERVICE_ID,
      query,
      variables
    });
  },
  mutate: async ({ mutation, variables }) => {
    return await AssistantAPIClient.executeGraphql({
      serviceId: LAMBDA_SERVICE_ID,
      query: mutation,
      variables
    });
  }
};

export const listLambdas = async serviceId => {
  return await client.query({
    query: LIST_LAMBDAS,
    variables: {
      serviceId
    }
  });
};

export const createLambdas = async lambdas => {
  let res = null;
  try {
    const result = await client.mutate({
      mutation: CREATE_LAMBDAS,
      variables: { inputs: lambdas }
    });

    const { data } = result;
    res = data.createLambdas;
  } catch (e) {
    console.log("Err", e);
  }
  return res;
};
