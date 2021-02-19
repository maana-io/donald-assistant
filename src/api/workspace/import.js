import {
  default as AssistantAPIClient,
  AssistantState
} from "@io-maana/q-assistant-client";
import { chunk, groupBy, isEmpty, omit } from "lodash";
import { createLambdas, getLambdaServiceBaseUrl } from "../myService";

import { logException } from "../util";
import uuid from "uuid";

function isFunctionGraphInputNode(node) {
  return node.id.endsWith("INPUT");
}

function isFunctionGraphOutputNode(node) {
  return node.id.endsWith("OUTPUT");
}

function getServiceItemId(oldItem, map, boilerplate) {
  if (!oldItem) return null;
  if (boilerplate && boilerplate[oldItem.id]) return boilerplate[oldItem.id];
  if (!oldItem.service) return oldItem.id;
  if (!(map[oldItem.service.id] && map[oldItem.service.id][oldItem.name])) {
    return oldItem.id;
  }

  return map[oldItem.service.id][oldItem.name];
}

async function importServices(services, currentWorkspace, addLogMessage) {
  try {
    await currentWorkspace.importServices(services.map(s => s.id));
  } catch (ex) {
    logException(
      addLogMessage,
      ex,
      "Failed to add the services to the workspace."
    );
    return null;
  }
  return await currentWorkspace.getImportedServices();
}

function updateFunctionImplementation(
  func,
  funcId,
  functionArguments,
  serviceFunctions,
  functionOperations,
  boilerplateFunctions,
  addLogMessage
) {
  addLogMessage(`Build Function Implementation for ${func.name}`);
  // Only update functions with an implementation
  if (!func.implementation || !func.implementation.operations) {
    return null;
  }

  const { entrypoint, operations } = func.implementation;

  const operationIDsMap = operations.reduce((map, op) => {
    map[op.id] = uuid();
    return map;
  }, {});
  functionOperations[funcId] = operationIDsMap;

  return {
    id: uuid(),
    entrypoint: entrypoint ? operationIDsMap[entrypoint.id] : null,
    operations: operations.map(op => {
      const opFuncId = getServiceItemId(
        op.function,
        serviceFunctions,
        boilerplateFunctions
      );

      return {
        id: operationIDsMap[op.id],
        type: op.type,
        function: opFuncId,
        argumentValues: op.argumentValues.map(argVal => {
          return {
            id: uuid(),
            argument: functionArguments[opFuncId][argVal.argument.name],
            operation: argVal.operation
              ? operationIDsMap[argVal.operation.id]
              : null,
            argumentRef: argVal.argumentRef
              ? functionArguments[funcId][argVal.argumentRef.name]
              : null
          };
        })
      };
    })
  };
}

export default async function importWorkspace(
  workspaceToImport,
  addLogMessage
) {
  let unlockWorkspace = false;
  let currentWorkspace = null;
  try {
    AssistantAPIClient.setAssistantState(AssistantState.WORKING);

    const {
      kinds: wsKinds = [],
      functions: wsFuncs = [],
      services: wsServices = [],
      assistants: wsAssistants = [],
      lambda: wsLambda = [],
      knowledgeGraphs: wsKnowledgeGraphs = [],
      boilerplate: wsBoilerplate = { kinds: [], functions: [] }
    } = workspaceToImport;
    currentWorkspace = await AssistantAPIClient.getWorkspace();

    // Check to see if the workspace is currently editable.
    const lockedBy = await currentWorkspace.lockedBy?.();
    if (!(await currentWorkspace.canEdit?.())) {
      addLogMessage(
        `Cannot import into Workspace ${currentWorkspace.name} as it is locked by ${lockedBy}`,
        true
      );
      return;
    }

    // Lock the workspace before starting the import.
    if (currentWorkspace.setLocked) {
      await currentWorkspace.setLocked(true);
      unlockWorkspace = !lockedBy;
    }

    // Add the services to the workspace
    addLogMessage(`Adding ${wsServices.length} Services to the Workspace.`);
    const importedServices = await importServices(
      wsServices,
      currentWorkspace,
      addLogMessage
    );
    if (
      !importedServices ||
      wsServices.some(wss => !importedServices.find(is => is.id === wss.id))
    ) {
      wsServices
        .filter(
          wss =>
            !(importedServices && importedServices.find(is => is.id === wss.id))
        )
        .map(s => addLogMessage(`Failed to import ${s.name} (${s.id})`, true));
      addLogMessage("Could not import all of the services.", true);
      return;
    }
    console.log(`Imported ${wsServices.length} Services`);

    // Make a map of the services to their kinds and functions
    addLogMessage(
      "Collecting information about the kind and functions of the added services."
    );
    const serviceKinds = {};
    const serviceFunctions = {};
    const functionArguments = {};
    const functionOperations = {};
    for (let service of importedServices) {
      addLogMessage(`Collecting information about: ${service.name}`);
      const kinds = await service.getKinds();
      const functions = await service.getFunctions();

      serviceKinds[service.id] = kinds.reduce((map, k) => {
        map[k.name] = k.id;
        return map;
      }, {});
      serviceFunctions[service.id] = functions.reduce((map, f) => {
        map[f.name] = f.id;
        return map;
      }, {});
      functions.reduce((fmap, f) => {
        fmap[f.id] = f.arguments.reduce((amap, a) => {
          amap[a.name] = a.id;
          return amap;
        }, {});
        return fmap;
      }, functionArguments);
    }

    addLogMessage("Generating IDs for the Kinds and Functions.");

    // Build the IDs for the new kinds
    const newKindIds = wsKinds.reduce((map, k) => {
      map[k.name] = uuid();
      return map;
    }, {});
    if (wsKinds.length) {
      serviceKinds[wsKinds[0].service.id] = newKindIds;
    }

    // Build the IDs for the new functions
    const newFuncIds = wsFuncs.reduce((map, f) => {
      const fid = uuid();
      map[f.name] = fid;
      functionArguments[fid] = f.arguments.reduce((amap, a) => {
        const aid = uuid();
        amap[a.name] = aid;
        return amap;
      }, {});
      return map;
    }, {});
    if (wsFuncs.length) {
      serviceFunctions[wsFuncs[0].service.id] = newFuncIds;
    }

    try {
      if (!isEmpty(wsLambda)) {
        addLogMessage(`Creating ${wsLambda.length} lambda functions.`);

        const oldServiceId = `${wsLambda[0].serviceId}_lambda`;
        const lambdaInputs = wsLambda
          .map(lambda => {
            if (
              !(
                newFuncIds[lambda.name] && wsFuncs.some(f => f.id === lambda.id)
              )
            ) {
              addLogMessage(
                `Unable to import lambda ${lambda.name} (${lambda.id}), as it's parent function does not exist anymore, skipping.`,
                true
              );
              return null;
            }

            return {
              ...lambda,
              runtime: undefined,
              id: newFuncIds[lambda.name],
              serviceId: currentWorkspace.id,
              runtimeId: lambda.runtime.id,
              sequenceNo: 0
            };
          })
          .filter(Boolean);

        const newLambdas = await createLambdas(lambdaInputs);

        if (newLambdas?.length !== lambdaInputs.length) {
          const missingLambda = newLambdas?.length
            ? lambdaInputs.filter(
                li => !newLambdas.some(nl => nl.name === li.name)
              )
            : lambdaInputs;

          throw new Error(
            `Failed to recreate lambdas ${missingLambda
              .map(l => l.name)
              .join(", ")}.`
          );
        }

        const lambdaServiceId = `${currentWorkspace.id}_lambda`;
        const lambdaEndpointBaseUrl = await getLambdaServiceBaseUrl();
        const serviceToImport = {
          id: lambdaServiceId,
          name: lambdaServiceId,
          endpointUrl: lambdaEndpointBaseUrl + currentWorkspace.id + "/graphql",
          serviceType: "EXTERNAL"
        };

        await AssistantAPIClient.createService(serviceToImport);
        await currentWorkspace.importService(lambdaServiceId);

        const lambdaService = await AssistantAPIClient.getServiceById(
          lambdaServiceId
        );
        const functions = await lambdaService.getFunctions();
        serviceFunctions[oldServiceId] = functions.reduce((map, f) => {
          map[f.name] = f.id;
          return map;
        }, {});
        functions.reduce((fmap, f) => {
          fmap[f.id] = f.arguments.reduce((amap, a) => {
            amap[a.name] = a.id;
            return amap;
          }, {});
          return fmap;
        }, functionArguments);
        const kinds = await lambdaService.getKinds();
        serviceKinds[oldServiceId] = kinds.reduce((map, k) => {
          map[k.name] = k.id;
          return map;
        }, {});
      }
    } catch (e) {
      addLogMessage(e.message, true);
      addLogMessage("Failed to import the lambda functions", true);
      return;
    }

    // TODO: Get list of lambda service's functions and add them to the service map.
    // TODO: Make sure that the function implementation's are updated properly

    // Add the kinds the workspace
    addLogMessage(`Import ${wsKinds.length} Kinds.`);
    const createKindsInput = wsKinds.map(kind => {
      return {
        id: newKindIds[kind.name],
        name: kind.name,
        description: kind.description,
        schema: kind.schema.map(field => {
          return {
            id: uuid(),
            name: field.name,
            type: field.type,
            typeKindId: getServiceItemId(field.kind, serviceKinds),
            modifiers: field.modifiers
          };
        })
      };
    });

    const createdKinds = await currentWorkspace.createKinds(createKindsInput);
    addLogMessage(`Imported ${createdKinds.length} Kinds.`);

    const KIND_DATA_CHUNK = 1000;
    addLogMessage("Adding the data into the Kinds");
    for (const kind of wsKinds) {
      if (isEmpty(kind.data)) continue;

      const createdKind = createdKinds.find(ck => ck.name === kind.name);
      if (!createdKind) continue;

      addLogMessage(`Adding data into the Kind ${createdKind.name}`);

      for (const data of chunk(kind.data, KIND_DATA_CHUNK)) {
        const functionId = `${createdKind.service.id}:${createdKind.id}:addMany`;
        await AssistantAPIClient.executeFunction({
          functionId,
          variables: { input: data }
        });
      }
    }
    // TODO: Report what kinds failed to import and then exit

    addLogMessage("Collecting Generated Kinds and Functions");
    // Make sure that the latest version of the kinds and boilerplate for the
    // workspace service are updated in cache.  Other assistants acting on the
    // inventory changed events can cause an outdated version of this to be
    // loaded.
    await AssistantAPIClient.reloadServiceSchema(
      currentWorkspace.workspaceServiceId
    );
    const genKinds = (await currentWorkspace.getKinds()).filter(
      k => k.isGenerated
    );
    const genFuncs = (await currentWorkspace.getFunctions()).filter(
      f => f.isGenerated
    );
    const genKindsMap = wsBoilerplate.kinds.reduce((map, oldKind) => {
      const newKind = genKinds.find(k => k.name === oldKind.name);
      if (newKind) {
        map[oldKind.id] = newKind.id;
      }
      return map;
    }, {});
    const genFuncsMap = wsBoilerplate.functions.reduce((map, oldFunc) => {
      const newFunc = genFuncs.find(f => f.name === oldFunc.name);
      if (newFunc) {
        map[oldFunc.id] = newFunc.id;
        functionArguments[newFunc.id] = newFunc.arguments.reduce((amap, a) => {
          amap[a.name] = a.id;
          return amap;
        }, {});
      }
      return map;
    }, {});

    // Create all the functions without implementations
    addLogMessage(`Importing ${wsFuncs.length} Functions.`);
    const createFunctionsInput = wsFuncs.map(func => {
      const funcId = newFuncIds[func.name];
      return {
        id: funcId,
        name: func.name,
        description: func.description,
        functionType: func.functionType,
        graphqlOperationType: func.graphqlOperationType,

        arguments: func.arguments.map(argument => ({
          id: functionArguments[funcId][argument.name],
          name: argument.name,
          type: argument.type,
          typeKindId: getServiceItemId(
            argument.kind,
            serviceKinds,
            genKindsMap
          ),
          modifiers: argument.modifiers
        })),

        outputType: func.outputType,
        outputModifiers: func.outputModifiers,
        outputKindId: getServiceItemId(func.kind, serviceKinds, genKindsMap),

        implementation: null
      };
    });
    const createdFunctions = await currentWorkspace.createFunctions(
      createFunctionsInput
    );
    addLogMessage(`Imported ${createdFunctions.length} Functions`);

    addLogMessage("Importing the Function Implementations");
    try {
      const updateFunctionInput = wsFuncs.reduce((updates, func) => {
        if (func.implementation && !isEmpty(func.implementation.operations)) {
          const createdFunction = createdFunctions.find(
            cf => cf.name === func.name
          );
          if (createdFunction) {
            updates.push({
              id: createdFunction.id,
              name: createdFunction.name,
              service: createdFunction.service.id,
              implementation: updateFunctionImplementation(
                func,
                createdFunction.id,
                functionArguments,
                serviceFunctions,
                functionOperations,
                genFuncsMap,
                addLogMessage
              )
            });
          }
        }
        return updates;
      }, []);

      await currentWorkspace.updateFunctions(updateFunctionInput);
    } catch (e) {
      console.log(e);
      addLogMessage(e.message, true);
      addLogMessage("Failed to import the function implementations", true);
      return;
    }

    addLogMessage("Setting the layout for the Function Graphs");
    for (const func of wsFuncs) {
      if (!func.graph) continue;

      addLogMessage(`Updating Function Graph ${func.name}`);
      const funcId = newFuncIds[func.name];
      const funcGraph = await AssistantAPIClient.getFunctionGraph(funcId);
      if (!funcGraph) {
        addLogMessage(
          `Function Graph ${func.name} does not exist on the current workspace, skipping.`,
          true
        );
        continue;
      }

      const nodes = await funcGraph.getNodes();
      if (nodes.length !== func.graph.nodes.length) continue;

      await funcGraph.updateGraphLayout({
        ...func.graph,
        nodes: func.graph.nodes
          .map(node => {
            let nodeId = null;

            if (isFunctionGraphInputNode(node)) {
              const inputNode = nodes.find(isFunctionGraphInputNode);
              if (!inputNode) return null;
              nodeId = inputNode.id;
            } else if (isFunctionGraphOutputNode(node)) {
              const outputNode = nodes.find(isFunctionGraphOutputNode);
              if (!outputNode) return null;
              nodeId = outputNode.id;
            } else {
              const otherNode = nodes.find(
                n =>
                  n.functionGraphNode &&
                  n.functionGraphNode.operationId ===
                    functionOperations[funcId][node.operationId]
              );
              if (!otherNode) return null;
              nodeId = otherNode.id;
            }

            return {
              ...node,
              id: nodeId
            };
          })
          .filter(Boolean)
      });
    }

    try {
      addLogMessage(`Importing ${wsKnowledgeGraphs.length} Knowledge Graphs`);
      if (wsKnowledgeGraphs.length) {
        const kgsToCreate = wsKnowledgeGraphs.map(kg => {
          return {
            ...kg,
            id: uuid(),
            nodes: kg.nodes?.map(node => {
              const isKind = !!node.kind;
              return {
                ...omit(node, ["kind", "function"]),
                width: 0,
                height: 0,
                id: uuid(),
                knowledgeGraphNode: {
                  id: uuid(),
                  instanceId: isKind
                    ? getServiceItemId(node.kind, serviceKinds, genKindsMap)
                    : getServiceItemId(
                        node.function,
                        serviceFunctions,
                        genFuncsMap
                      ),
                  kindName: isKind ? "Kind" : "Function"
                }
              };
            })
          };
        });
        const kgs = await currentWorkspace.createKnowledgeGraphs(kgsToCreate);
        addLogMessage(`Imported ${kgs.length} Knowledge Graphs`);
      }
    } catch (e) {
      console.log("Creating KGs Error", e);
      logException(addLogMessage, e, "Failed to import the knowledge graphs");
      return;
    }

    await AssistantAPIClient.reloadServiceSchema(
      currentWorkspace.workspaceServiceId
    );

    // Add the assistants to the workspace
    addLogMessage(`Adding ${wsAssistants.length} Assistants to the Workspace.`);
    await importServices(wsAssistants, currentWorkspace, addLogMessage);
    const allAssistants = await currentWorkspace.getImportedAssistants();
    const {
      true: importedAssistants = [],
      false: missingAssistants
    } = groupBy(wsAssistants, a => allAssistants.some(aa => aa.id === a.id));
    if (missingAssistants) {
      missingAssistants.forEach(ma =>
        addLogMessage(
          `Failed to import ${ma.name} (${ma.id}) Assistant, skipping`,
          true
        )
      );
    }
    addLogMessage(`Imported ${importedAssistants.length} Assistants`);

    addLogMessage("Done importing the workspace!");
  } catch (e) {
    console.log(e);
    logException(addLogMessage, e, "Failed to import the workspace.");
  } finally {
    AssistantAPIClient.setAssistantState(AssistantState.IDLE);
    if (unlockWorkspace && currentWorkspace) currentWorkspace.setLocked(false);
  }
}
