import {
  Argument,
  FunctionType,
  Product,
  ProductField,
  ServiceAndNameLocator,
  TypeExpression,
  decodeTypeExpression,
  encodeTypeExpression,
  traverseTypeExpression
} from "@maana-io/typesystem-utils";
import AssistantAPIClient, {
  AssistantState,
  CreateEntityInput,
  CreateServiceInput,
  EntityIdentifier,
  EntityType,
  ImplementationType,
  Maybe,
  NodeType,
  ServiceType,
  TypeExpressionObject,
  UpdateWorkspaceInput,
  Workspace
} from "@io-maana/q-assistant-client";
import { createLambdas, getLambdaServiceBaseUrl } from "./myService";
import {
  graphExportToInput,
  isFunctionGraphInputNode,
  isFunctionGraphOutputNode
} from "../util/graphs";
import { groupBy, isEmpty, omit } from "lodash";

import { EXPORT_FILE_VERSION } from "../util/constants";
import { LogFunc } from "../models/common";
import { WorkspaceExport } from "../models/export";
import { importServices } from "../util/services";
import { logException } from "../util/logging";
import { v4 as uuid } from "uuid";

function cleanAndUpdateSignature(
  teo: TypeExpressionObject,
  oldServiceId: string,
  newServiceId: string,
  oldPersistenceId: string,
  newPersistenceId: string
): TypeExpressionObject {
  function updateTypeExpression(te: TypeExpression): TypeExpression {
    return traverseTypeExpression(te, {
      onProduct(p) {
        // TODO: Update Service and Name references for local types.
        return new Product({
          extendable: p.extendable,
          fields: p.fields.map(
            f =>
              new ProductField({
                ...omit(f, "id"),
                type: updateTypeExpression(f.type)
              })
          )
        });
      },
      onFunctionType(ft) {
        return new FunctionType({
          arguments: ft.arguments.map(
            a =>
              new Argument({
                ...omit(a, "id"),
                type: updateTypeExpression(a.type)
              })
          ),
          resultType: updateTypeExpression(ft.resultType)
        });
      },
      onServiceAndNameLocator(sn) {
        if (sn.serviceId === oldServiceId) {
          return new ServiceAndNameLocator({
            name: sn.name,
            serviceId: newServiceId
          });
        } else if (sn.serviceId === oldPersistenceId) {
          return new ServiceAndNameLocator({
            name: sn.name,
            serviceId: newPersistenceId
          });
        } else {
          return sn;
        }
      }
    });
  }

  return encodeTypeExpression(updateTypeExpression(decodeTypeExpression(teo)));
}

export async function importWorkspace(
  importData: Partial<WorkspaceExport>,
  addLogMessage: LogFunc
): Promise<void> {
  let unlockWorkspace = false;
  let currentWorkspace: Maybe<Workspace> = null;
  try {
    AssistantAPIClient.setAssistantState(AssistantState.WORKING);

    const {
      version,
      serviceId: oldServiceId,
      persistenceServiceId: oldPersistenceId,
      types: wsKinds = [],
      functions: wsFuncs = [],
      services: wsServices = [],
      assistants: wsAssistants = [],
      lambda: wsLambda = [],
      knowledgeGraphs: wsKnowledgeGraphs = []
    } = importData;

    if (version !== EXPORT_FILE_VERSION) {
      throw new Error(
        `Export file format version is ${version} and version ${EXPORT_FILE_VERSION} is expected.`
      );
    }

    if (!oldServiceId) {
      throw new Error(
        "Missing information about the original service ID in the data."
      );
    }

    if (!oldPersistenceId) {
      throw new Error(
        "Missing information about the original persistance service ID in the data."
      );
    }

    currentWorkspace = await AssistantAPIClient.getWorkspace();
    if (!currentWorkspace) {
      throw new Error(
        "Failed to load the workspace. Make sure you are the owner or that it is marked as public."
      );
    }
    const {
      id: newWorkspaceId,
      serviceId: newServiceId,
      persistenceServiceId: newPersistenceId
    } = currentWorkspace;

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
    const serviceKinds: Record<string, Record<string, string>> = {};
    const serviceFunctions: Record<string, Record<string, string>> = {};
    const functionArguments: Record<string, Record<string, string>> = {};
    const functionOperations: Record<string, Record<string, string>> = {};
    for (let service of importedServices) {
      addLogMessage(`Collecting information about: ${service.name}`);
      const kinds = await service.getKinds();
      const functions = await service.getFunctions();

      serviceKinds[service.id] = kinds.reduce((map, k) => {
        map[k.name] = k.id;
        return map;
      }, {} as Record<string, string>);
      serviceFunctions[service.id] = functions.reduce((map, f) => {
        map[f.name] = f.id;
        return map;
      }, {} as Record<string, string>);
      functions.reduce((fmap, f) => {
        traverseTypeExpression(decodeTypeExpression(f.signature), {
          onFunctionType(ft) {
            fmap[f.id] = ft.arguments.reduce((amap, a) => {
              if (a.name && a.id) amap[a.name] = a.id;
              return amap;
            }, {} as Record<string, string>);
            return ft;
          }
        });
        return fmap;
      }, functionArguments);
    }

    addLogMessage("Generating IDs for the Kinds and Functions.");

    // Build the IDs for the new kinds
    const newKindIds: Record<string, string> = wsKinds.reduce((map, k) => {
      map[k.name] = uuid();
      return map;
    }, {} as Record<string, string>);
    if (wsKinds.length) {
      serviceKinds[wsKinds[0].service.id] = newKindIds;
    }

    // Build the IDs for the new functions
    const newFuncIds: Record<string, string> = wsFuncs.reduce((map, f) => {
      const fid = uuid();
      map[f.name] = fid;
      traverseTypeExpression(decodeTypeExpression(f.signature), {
        onFunctionType(ft) {
          functionArguments[fid] = ft.arguments.reduce((amap, a) => {
            const aid = uuid();
            if (a.name) amap[a.name] = aid;
            return amap;
          }, {} as Record<string, string>);
          return ft;
        }
      });
      if (f.graph) {
        functionOperations[f.id] = f.graph.nodes.reduce((omap, n) => {
          omap[n.id] = uuid();
          if (n.type === NodeType.ARGUMENT) {
            if (isFunctionGraphInputNode(n)) {
              omap[n.id] = `${omap[n.id]}INPUT`;
            } else if (isFunctionGraphOutputNode(n)) {
              omap[n.id] = `${omap[n.id]}OUTPUT`;
            }
          }
          return omap;
        }, {} as Record<string, string>);
      }
      return map;
    }, {} as Record<string, string>);
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
                `Unable to import lambda ${lambda.name} (${lambda.id}), as it's parent function does not exist anymore. Skipping.`,
                true
              );
              return null;
            }

            return {
              ...lambda,
              runtime: undefined,
              id: newFuncIds[lambda.name],
              serviceId: newWorkspaceId,
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

        const lambdaServiceId = `${newWorkspaceId}_lambda`;
        const lambdaEndpointBaseUrl = await getLambdaServiceBaseUrl();
        const serviceToImport: CreateServiceInput = {
          id: lambdaServiceId,
          name: lambdaServiceId,
          endpointUrl: lambdaEndpointBaseUrl + newWorkspaceId + "/graphql",
          serviceType: ServiceType.EXTERNAL_GRAPHQL
        };

        await AssistantAPIClient.createService(serviceToImport);
        await currentWorkspace.importService(lambdaServiceId);

        const lambdaService = await AssistantAPIClient.getServiceById(
          lambdaServiceId
        );
        if (!lambdaService) {
          throw new Error(
            "Failed to load the lambda service after creating it."
          );
        }

        const functions = await lambdaService.getFunctions();
        serviceFunctions[oldServiceId] = functions.reduce((map, f) => {
          map[f.name] = f.id;
          return map;
        }, {} as Record<string, string>);
        functions.reduce((fmap, f) => {
          traverseTypeExpression(decodeTypeExpression(f.signature), {
            onFunctionType(ft) {
              fmap[f.id] = ft.arguments.reduce((amap, a) => {
                if (a.name && a.id) amap[a.name] = a.id;
                return amap;
              }, {} as Record<string, string>);
              return ft;
            }
          });
          return fmap;
        }, functionArguments);
        const kinds = await lambdaService.getKinds();
        serviceKinds[oldServiceId] = kinds.reduce((map, k) => {
          map[k.name] = k.id;
          return map;
        }, {} as Record<string, string>);
      }

      const rewriteEntityIdentifier = (
        ei: EntityIdentifier
      ): EntityIdentifier => {
        if (
          ei.entityType === EntityType.FUNCTION ||
          ei.entityType === EntityType.TYPE
        ) {
          if (ei.serviceId === oldServiceId) {
            return {
              ...ei,
              serviceId: newServiceId
            };
          } else if (ei.serviceId === oldPersistenceId) {
            return {
              ...ei,
              serviceId: newPersistenceId
            };
          }
        }

        return ei;
      };

      // Start building the updates for the workspace
      const workspaceUpdates: UpdateWorkspaceInput = {
        id: newWorkspaceId
      };

      const createEntities: CreateEntityInput[] = [];

      addLogMessage(`Import ${wsKinds.length} Kinds.`);
      createEntities.push(
        ...wsKinds.map(k => {
          return {
            entityType: EntityType.TYPE,
            type: {
              name: k.name,
              description: k.description,
              signature: cleanAndUpdateSignature(
                k.signature,
                oldServiceId,
                newServiceId,
                oldPersistenceId,
                newPersistenceId
              ),
              isManaged: k.isManaged
            }
          };
        })
      );

      addLogMessage(`Importing ${wsFuncs.length} Functions.`);
      createEntities.push(
        ...wsFuncs.map(f => {
          return {
            entityType: EntityType.FUNCTION,
            function: {
              name: f.name,
              description: f.description,
              signature: cleanAndUpdateSignature(
                f.signature,
                oldServiceId,
                newServiceId,
                oldPersistenceId,
                newPersistenceId
              ),
              isPure: f.isPure,
              graphqlFunctionType: f.graphqlFunctionType,
              implementation: ImplementationType.FUNCTION_GRAPH,
              graphImplementation: graphExportToInput(
                f.graph,
                functionOperations[f.id] ?? {},
                functionArguments[f.id] ?? {}, // TODO: (QP-2264) Figure out how to handle args for other services
                rewriteEntityIdentifier
              )
              // TODO: (QP-2264) Handle Input Masks...
            }
          };
        })
      );

      addLogMessage(`Importing ${wsKnowledgeGraphs.length} Knowledge Graphs`);
      createEntities.push(
        ...wsKnowledgeGraphs.map(kg => {
          return {
            entityType: EntityType.KNOWLEDGE_GRAPH,
            knowledgeGraph: {
              name: kg.name,
              description: kg.description,
              graph: graphExportToInput(
                kg.graph,
                {},
                {},
                rewriteEntityIdentifier
              )
            }
          };
        })
      );

      if (!isEmpty(createEntities)) {
        workspaceUpdates.createEntities = createEntities;
      }

      // Send the final updates to the workspace.
      addLogMessage(
        "Updating the workspace with the Kinds, Functions, and Knowledge Graphs."
      );
      await currentWorkspace.update(workspaceUpdates);
      addLogMessage("Workspace Updated.");

      // TODO: (QP-2264) Push up the data in the kinds

      // Add the assistants to the workspace
      addLogMessage(
        `Adding ${wsAssistants.length} Assistants to the Workspace.`
      );
      await importServices(wsAssistants, currentWorkspace, addLogMessage);
      const allAssistants = await currentWorkspace.getImportedAssistants();
      const {
        true: importedAssistants = [],
        false: missingAssistants
      } = groupBy(wsAssistants, a => allAssistants.some(aa => aa.id === a.id));
      if (missingAssistants) {
        missingAssistants.forEach(ma =>
          addLogMessage(
            `Failed to import ${ma.name} (${ma.id}) Assistant. Skipping`,
            true
          )
        );
      }
      addLogMessage(`Imported ${importedAssistants.length} Assistants`);

      addLogMessage("Done importing the workspace!");
    } catch (e) {
      addLogMessage(e.message, true);
      addLogMessage("Failed to import the lambda functions", true);
      return;
    }
  } catch (e) {
    console.log(e);
    logException(addLogMessage, e, "Failed to import the workspace.");
  } finally {
    AssistantAPIClient.setAssistantState(AssistantState.IDLE);
    if (unlockWorkspace && currentWorkspace) currentWorkspace.setLocked(false);
  }
}
