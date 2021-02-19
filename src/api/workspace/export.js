import { flatten, groupBy, isEmpty, isNil, omit, pick, uniqBy } from "lodash";

import AssistantAPIClient from "@io-maana/q-assistant-client";
import { listLambdas } from "../myService";
import { logException } from "../../util/logging";

const EXPORT_FILE_VERSION = 1;
const KIND_DATA_TAKE = 1000;
const SERVICE_EXPORT_FIELDS = ["id", "name"];

async function getServiceInformation(service, serviceMap) {
  // If there is no service to get information for, then return null.  This is
  // needed for system level kinds.
  if (!service) return null;

  // If the information is in the map, then just return it
  let serviceInfo = serviceMap[service.id];
  if (serviceInfo) return serviceInfo;

  // Check to see if the service has a parent, and then use that.
  const serviceObj = await AssistantAPIClient.getServiceById(service.id);
  if (serviceObj) {
    const parent = await serviceObj.getParentService();
    if (parent) {
      serviceMap[parent.id] = parent;
      return pick(parent, SERVICE_EXPORT_FIELDS);
    }
  }

  // If all else fails, return save the service to the map and return it.
  serviceMap[service.id] = service;
  return service;
}

async function updateFieldKindService(field, serviceMap) {
  if (field?.kind?.service) {
    const service = await getServiceInformation(field.kind.service, serviceMap);
    return {
      ...field,
      kind: {
        ...field.kind,
        service: service
      }
    };
  }
  return field;
}

function queryKindData({
  functionId,
  mutationName,
  resolve,
  collectedData,
  addLogMessage
}) {
  return AssistantAPIClient.executeFunction({
    functionId,
    variables: { take: KIND_DATA_TAKE, offset: collectedData.length },
    resolve
  }).then(res =>
    collectKindData({
      functionId,
      mutationName,
      resolve,
      collectedData,
      res,
      addLogMessage
    })
  );
}

async function collectKindData({
  functionId,
  mutationName,
  resolve,
  collectedData,
  res,
  addLogMessage
}) {
  const { data, errors } = res;
  if (errors) {
    throw errors;
  }

  // No additional data for this kind, return what has been collected.
  if (!data || isEmpty(data[mutationName])) {
    return collectedData;
  }

  // Collect the additional data for this kind.
  collectedData = collectedData.concat(data[mutationName]);

  // Fewer than max instances of data collected, so their is none left.
  if (data[mutationName].length < KIND_DATA_TAKE) {
    return collectedData;
  }

  // Pull for more data
  return await queryKindData({
    functionId,
    mutationName,
    resolve,
    collectedData
  });
}

function processFieldValue(value) {
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

export default async function getWorkspace(exportKindData, addLogMessage) {
  try {
    addLogMessage("Loading Workspace information.");
    const workspace = await AssistantAPIClient.getWorkspace();
    const { modelServiceId, logicServiceId, workspaceServiceId } = workspace;
    await AssistantAPIClient.reloadServiceSchema(workspaceServiceId);
    const currentSelection = await AssistantAPIClient.getCurrentSelection();
    const kinds = await workspace.getKinds();
    const functions = await workspace.getFunctions();

    const serviceMap = {
      [modelServiceId]: { id: workspaceServiceId, name: workspace.name },
      [logicServiceId]: { id: workspaceServiceId, name: workspace.name }
    };

    // Collect the services and their information for supporting exporting.
    addLogMessage("Loading information about the Services.");
    const importedServices = await workspace.getImportedServices();
    const {
      true: lambdaServices = [],
      false: otherServices = []
    } = groupBy(importedServices, s => s.id.endsWith("_lambda"));
    const services = await Promise.all(
      otherServices.map(async importedService => {
        addLogMessage(
          `Loading information about ${importedService.name} (${importedService.id})`
        );
        // Get the basic information about the service
        const { id, name, aggregatedServices } = importedService;
        const baseService = { id, name };

        // Get the kinds and functions in the service
        const kinds = await importedService.getKinds();
        const functions = await importedService.getFunctions();

        // Get a map of the mode/logic services -> workspace service
        serviceMap[id] = baseService;
        if (!isEmpty(aggregatedServices)) {
          aggregatedServices.forEach(aid => {
            serviceMap[aid] = baseService;
          });
        }

        return {
          ...baseService,
          kinds,
          functions
        };
      })
    );

    addLogMessage("Loading information about the Assistants.");
    const assistants = (await workspace.getImportedAssistants()).map(a =>
      pick(a, SERVICE_EXPORT_FIELDS)
    );
    addLogMessage(`Exporting ${assistants.length} Assistants`);

    addLogMessage("Loading information about Lambdas");
    let lambdaToExport = [];
    const lambdaService = lambdaServices.find(s =>
      s.id.startsWith(workspace.id)
    );
    if (lambdaService) {
      addLogMessage(`Loading data for the ${lambdaService.id} lambda service.`);
      serviceMap[lambdaService.id] = pick(lambdaService, SERVICE_EXPORT_FIELDS);
      const { data, errors } = await listLambdas(
        lambdaService.id.substring(0, lambdaService.id.lastIndexOf("_lambda"))
      );

      if (errors) {
        errors.forEach(e => addLogMessage(e.message, true));
        throw new Error(`Failed to load lambda service ${lambdaService.id}`);
      }

      if (data && !isEmpty(data.listLambdas)) {
        // Find the lambdas to export and the ones to not export
        let badLambdas = [];
        ({ true: lambdaToExport, false: badLambdas } = groupBy(
          data.listLambdas,
          l => functions.some(f => f.id === l.id)
        ));

        // Message about the lambdas that we are skipping
        if (!isEmpty(badLambdas)) {
          badLambdas.forEach(l =>
            addLogMessage(
              `Warning: Unable to export lambda ${l.name} (${l.id}), as it's parent function does not exist anymore. skipping.`,
              true
            )
          );
        }

        // Message about the number lambdas to export
        addLogMessage(`Exporting ${lambdaToExport.length} Lambda Functions.`);
      } else {
        addLogMessage("No Lambda functions to Export.");
      }
    } else {
      addLogMessage("This workspace does not have a lambda setup for it.");
    }

    lambdaServices.forEach(s => {
      if (!s.id.startsWith(workspace.id)) {
        addLogMessage(
          `Lambda service ${s.id} from another workspace cannot be exported, skipping.`,
          true
        );
      }
    });

    addLogMessage("Prepping Kinds for export.");
    const { true: genKinds = [], false: wsKinds = [] } = groupBy(
      kinds,
      k => !!k.isGenerated
    );
    // Gather the workspace function that are not boilerplate for export.
    const kindsToExport = [];
    for (const k of wsKinds) {
      addLogMessage(`Collecting data for Kind ${k.name} (${k.id})`);

      const functionId = `${k.service.id}:${k.id}:queryAll`;
      const resolve =
        "{" +
        k.schema.map(f => (f.kind ? `${f.name} { id }` : f.name)).join(" ") +
        "}";
      const mutationName = `all${k.name}s`;

      // Load the data inside of the kind when asked for.
      let data = undefined;
      try {
        if (exportKindData) {
          data = (
            await queryKindData({
              functionId,
              mutationName,
              resolve,
              collectedData: [],
              addLogMessage
            })
          ).map(data =>
            Object.keys(data).reduce((instance, k) => {
              instance[k] = processFieldValue(data[k]);
              return instance;
            }, {})
          );
        }
      } catch (e) {
        logException(
          addLogMessage,
          e,
          `Failed to query data for Kind ${k.name}, skipping the exporting its data.`
        );
      }

      // Process the kind's schema
      const schema = [];
      for (const field of k.schema) {
        schema.push(await updateFieldKindService(field, serviceMap));
      }

      // Process the kind
      kindsToExport.push({
        ...omit(k, ["isGenerated"]),
        service: await getServiceInformation(k.service, serviceMap),
        schema,
        data
      });
    }
    addLogMessage(`Exporting ${kindsToExport.length} Kinds.`);

    addLogMessage("Prepping Functions for export.");
    const { true: genFuncs = [], false: wsFuncs = [] } = groupBy(
      functions,
      f => !!f.isGenerated
    );
    // Gather the workspace functions that are not boilerplate for export.
    let functionsToExport = [];
    for (const f of wsFuncs) {
      addLogMessage(`Collecting data for Function ${f.name} (${f.id})`);

      let saveGraph = null;
      if (f.implementation && !isEmpty(f.implementation.operations)) {
        const funcGraph = await AssistantAPIClient.getFunctionGraph(f.id);
        saveGraph = {
          zoom: funcGraph.zoom,
          offsetX: funcGraph.offsetX,
          offsetY: funcGraph.offsetY,
          nodes: (await funcGraph.getNodes()).map(node => ({
            id: node.id,
            x: node.x,
            y: node.y,
            collapsed: node.collapsed,
            operationId:
              node.functionGraphNode && node.functionGraphNode.operationId
          }))
        };
      }

      // Process the function's arguments
      const args = [];
      for (const arg of f.arguments) {
        args.push(await updateFieldKindService(arg, serviceMap));
      }

      // Process the operations in the functions implementation
      const hasImplementation = !isEmpty(f?.implementation?.operations);
      const operations = [];
      if (hasImplementation) {
        for (const op of f.implementation.operations) {
          operations.push({
            ...op,
            function: {
              ...op.function,
              service: await getServiceInformation(
                op.function.service,
                serviceMap
              )
            },
            argumentValues: op.argumentValues.map(av => ({
              ...av,
              argumentRef: av.argumentRef
                ? pick(
                    f.arguments.find(a => a.id === av.argumentRef),
                    ["id", "name"]
                  )
                : null
            }))
          });
        }
      }

      // Process the function
      functionsToExport.push({
        ...omit(f, ["isGenerated"]),
        service: serviceMap[f.service.id],
        arguments: args,
        kind: f.kind
          ? (await updateFieldKindService(f, serviceMap)).kind
          : null,
        implementation: hasImplementation
          ? {
              ...f.implementation,
              operations
            }
          : null,
        graph: saveGraph
      });
    }
    addLogMessage(`Exporting ${functionsToExport.length} Functions.`);

    addLogMessage("Prepping Generated Kinds and Functions for export.");
    const boilerplate = {
      kinds: genKinds.map(k => pick(k, ["id", "name"])),
      functions: genFuncs.map(f => pick(f, ["id", "name"]))
    };
    addLogMessage(`Exporting ${boilerplate.kinds.length} Generated Kinds.`);
    addLogMessage(
      `Exporting ${boilerplate.functions.length} Generated Functions.`
    );

    // Gather the information about the knowledge graphs to be exported
    addLogMessage("Loading and Prepping Knowledge Graphs for export.");
    const graphs = await workspace.getKnowledgeGraphs();
    const knowledgeGraphs = [];
    for (const graph of graphs.filter(Boolean)) {
      addLogMessage(
        `Collecting data for Knowledge Graph ${graph.name} (${graph.id})`
      );
      const nodes = await graph.getNodes();

      const updatedNodes = [];
      for (const node of nodes) {
        const { innerKind, innerFunction } = node.knowledgeGraphNode ?? {};

        // Only process nodes that have have a function or a kind
        if (!innerFunction && !innerKind) {
          continue;
        }

        const updated = {
          ...omit(node, ["knowledgeGraphNode", "functionGraphNode"])
        };

        if (innerKind) {
          // Bring the kind information up a level
          updated.kind = pick(innerKind, [
            "id",
            "name",
            "service",
            "isGenerated"
          ]);
          updated.kind.service = await getServiceInformation(
            updated.kind.service,
            serviceMap
          );
        } else if (innerFunction) {
          // Bring the function information up a level
          updated.function = pick(innerFunction, [
            "id",
            "name",
            "service",
            "isGenerated"
          ]);
          updated.function.service = await getServiceInformation(
            updated.function.service,
            serviceMap
          );
        }

        updatedNodes.push(updated);
      }

      knowledgeGraphs.push({
        ...pick(graph, ["id", "name", "offsetX", "offsetY", "zoom"]),
        nodes: updatedNodes
      });
    }
    addLogMessage(`Exporting ${knowledgeGraphs.length} Knowledge Graphs`);

    // Gather the services in the workspace to be exported
    addLogMessage("Prepping Services for Export");
    const servicesToExport = uniqBy(
      services
        .concat(
          // Services for kinds used as kind fields
          flatten(
            kindsToExport.map(k =>
              k.schema
                .filter(f => f.kind && f.kind.service)
                .map(f => f.kind.service)
            )
          ),
          // Services for kinds used as a functions arguments or output.  Also
          // the services for the functions used in the implementation
          flatten(
            functionsToExport.map(f => {
              let services = f.arguments
                .filter(a => a.kind && a.kind.service)
                .map(a => a.kind.service);
              if (f.kind && f.kind.service) {
                services.push(f.kind.service);
              }
              if (f.implementation && f.implementation.operations) {
                services = services.concat(
                  f.implementation.operations
                    .filter(o => o.function && o.function.service)
                    .map(o => o.function.service)
                );
              }
              return services;
            })
          ),
          // Services for kinds and functions on the knowledge graphs.
          flatten(
            knowledgeGraphs.map(kg =>
              kg.nodes
                .map(
                  n =>
                    (n.kind && n.kind.service) ||
                    (n.function && n.function.service)
                )
                .filter(Boolean)
            )
          )
        )
        .map(s => pick(s, SERVICE_EXPORT_FIELDS)),
      s => s.id
    ).filter(
      s =>
        s.id !== modelServiceId &&
        s.id !== logicServiceId &&
        s.id !== workspaceServiceId &&
        !s.id.endsWith("_lambda")
    );
    addLogMessage(`Exporting ${servicesToExport.length} Services`);

    // Build the final information
    return {
      version: EXPORT_FILE_VERSION,
      id: workspace.id,
      name: workspace.name,
      kinds: kindsToExport,
      functions: functionsToExport,
      services: servicesToExport,
      assistants,
      lambda: lambdaToExport,
      endpointServiceId: workspaceServiceId,
      currentSelection: currentSelection.selection[0],
      knowledgeGraphs,
      boilerplate
    };
  } catch (e) {
    addLogMessage(`Failed to export the workspace: ${e.message}`, true);
    console.log("Failed to fetch workspace", e);
  }
}
