import { isEmpty, isNil } from "lodash";

import { Function } from "@io-maana/q-assistant-client";

const KIND_DATA_TAKE = 1000;

interface QueryKindDataInput {
  func: Function;
  resolve: string;
  collectedData: Record<string, any>[];
}

interface CollectKindDataInput extends QueryKindDataInput {
  res: {
    data?: Record<string, Record<string, any> | undefined>;
    errors?: any[];
  };
}

async function collectKindData({
  func,
  resolve,
  collectedData,
  res
}: CollectKindDataInput): Promise<Record<string, any>[]> {
  const { data, errors } = res;
  if (errors) {
    throw errors;
  }

  const mutationName = func.name;

  // No additional data for this kind, return what has been collected.
  if (!data || isEmpty(data[mutationName])) {
    return collectedData;
  }

  // Collect the additional data for this kind.
  collectedData = collectedData.concat(data[mutationName]);

  // Fewer than max instances of data collected, so there is none left.
  if (data[mutationName].length < KIND_DATA_TAKE) {
    return collectedData;
  }

  // Pull for more data
  return await queryKindData({
    func,
    resolve,
    collectedData
  });
}

function queryKindData({
  func,
  resolve,
  collectedData
}: QueryKindDataInput): Promise<Record<string, any>[]> {
  return func
    .execute({ take: KIND_DATA_TAKE, offset: collectedData.length }, resolve)
    .then(res =>
      collectKindData({
        func,
        resolve,
        collectedData,
        res
      })
    );
}

function processFieldValue(value: any): any {
  if (isNil(value)) {
    return null;
  } else if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map(processFieldValue);
    } else {
      return value.id;
    }
  } else {
    return value;
  }
}

/**
 * Queries for data stored in a managed type from a specific function.
 *
 * @param func The function to use to load the data.
 * @param resolve The resolve string
 *
 * @returns The loaded data
 */
export async function loadManagedTypeData(
  func: Function,
  resolve: string
): Promise<Record<string, any>[]> {
  const data = await queryKindData({ func, resolve, collectedData: [] }).then();
  return data.map(data =>
    Object.keys(data).reduce((instance, k) => {
      instance[k] = processFieldValue(data[k]);
      return instance;
    }, {})
  );
}
