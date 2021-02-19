const lambdaDetailedFragment = `
    fragment lambdaDetailed on Lambda {
      id
      name
      serviceId
      runtime {
        id
      }
      code
      input {
        name
        kind
        modifiers
      }
      outputKind
      outputModifiers
      kinds {
        name
        fields {
          name
          kind
          modifiers
        }
      }
      graphQLOperationType
    }
  `;

export const LIST_LAMBDAS = `
  query listLambdas($serviceId: ID!) {
    listLambdas(serviceId: $serviceId) {
      ...lambdaDetailed
    }
  }
  ${lambdaDetailedFragment}
`;

export const CREATE_LAMBDAS = `
  mutation createLambda($inputs: [LambdaInput!]!) {
    createLambdas(
      inputs: $inputs
    ) {
      id
      name
      serviceId
      runtime {
        id
      }
      code
      input {
        name
        kind
        modifiers
      }
      outputKind
      outputModifiers
      kinds {
        name
        fields {
          name
          kind
          modifiers
        }
      }
    }
  }
`;
