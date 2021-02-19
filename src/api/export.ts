import {
  AssistantAPIClient,
  CORE_SERVICE_ID,
  NodeType
} from "@io-maana/q-assistant-client";
import { EXPORT_FILE_VERSION, LAMBDA_POSTFIX } from "../util/constants";
import {
  FunctionExport,
  GraphExport,
  KnowledgeGraphExport,
  LambdaExport,
  ServiceExport,
  TypeExport,
  WorkspaceExport
} from "../models/export";
import {
  decodeTypeExpression,
  traverseTypeExpression
} from "@maana-io/typesystem-utils";
import { getServiceInformation, serviceToExport } from "../util/services";
import { groupBy, isEmpty, omit, pick } from "lodash";

import { AssistantState } from "@io-maana/q-assistant-client";
import { LogFunc } from "../models/common";
import { ServiceType } from "@io-maana/q-assistant-client";
import { listLambdas } from "./myService";
import { loadManagedTypeData } from "../util/types";
import { logException } from "../util/logging";
import { prepareGraphRefForExport } from "../util/graphs";

export async function exportWorkspace(
  exportManagedData: boolean,
  addLogMessage: LogFunc
): Promise<WorkspaceExport | null> {
  try {
    AssistantAPIClient.setAssistantState(AssistantState.WORKING);
    addLogMessage("Loading Workspace information.");
    const workspace = await (await AssistantAPIClient.getWorkspace())?.reload();
    if (!workspace) {
      addLogMessage("Unable to load the Workspace.", true);
      return null;
    }

    const { serviceId, name } = workspace;
    const types = await workspace.getKinds();
    const funcs = await workspace.getFunctions();

    const serviceMap: Record<string, ServiceExport> = {
      [serviceId]: {
        id: serviceId,
        name,
        type: ServiceType.LOGIC,
        endpointUrl: workspace.location.url
      }
    };

    // Collect the services and their information for supporting exporting.
    addLogMessage("Loading information about the Services.");
    const importedServices = await workspace.getImportedServices();
    const {
      true: lambdaServices = [],
      false: otherServices = []
    } = groupBy(importedServices, s => s.id.endsWith(LAMBDA_POSTFIX));
    const services = await Promise.all(
      otherServices.map(async importedService => {
        addLogMessage(
          `Loading information about ${importedService.name} (${importedService.id})`
        );
        // Get the basic information about the service
        const { id, name, location, type } = importedService;
        const baseService = { id, name, endpointUrl: location.url, type };

        // Get the kinds and functions in the service
        const kinds = await importedService.getKinds();
        const functions = await importedService.getFunctions();

        // Get a map of the service ids to their export data.
        serviceMap[id] = baseService;

        return {
          ...baseService,
          kinds,
          functions
        };
      })
    );

    addLogMessage("Loading information about the Assistants.");
    const assistants: ServiceExport[] = (
      await workspace.getImportedAssistants()
    ).map(serviceToExport);
    addLogMessage(`Exporting ${assistants.length} Assistants`);

    addLogMessage("Loading information about Lambdas");
    let lambdaToExport: LambdaExport[] = [];
    const lambdaService = lambdaServices.find(s =>
      s.id.startsWith(workspace.id)
    );
    if (lambdaService) {
      addLogMessage(`Loading data for the ${lambdaService.id} lambda service.`);
      serviceMap[lambdaService.id] = serviceToExport(lambdaService);
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
          l => funcs.some(f => f.id === l.id)
        ));

        // Message about the lambdas that we are skipping
        if (!isEmpty(badLambdas)) {
          badLambdas.forEach(l =>
            addLogMessage(
              `Warning: Unable to export lambda ${l.name} (${l.id}), as it's parent function does not exist anymore. Skipping.`,
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
      addLogMessage("This workspace does not have any lambda functions.");
    }

    lambdaServices.forEach(s => {
      if (!s.id.startsWith(workspace.id)) {
        addLogMessage(
          `Lambda service ${s.id} from another workspace cannot be exported. Skipping.`,
          true
        );
      }
    });

    // Gather the workspace function that are not boilerplate for export.
    const kindsToExport: TypeExport[] = [];
    for (const k of types) {
      // Load the data inside of the kind when asked for.
      let data: Record<string, any>[] | undefined = undefined;
      try {
        const mutationName = `all${k.name}s`;
        const func = funcs.find(f => f.name === mutationName);
        if (exportManagedData && func) {
          addLogMessage(`Collecting data for Kind ${k.name} (${k.id})`);

          const resolveFields: string[] = [];
          traverseTypeExpression(decodeTypeExpression(k.signature), {
            // TODO: (QP-2264) Support more than product types here.
            onProduct(pt) {
              pt.fields.forEach(f => {
                let complex = true;
                traverseTypeExpression(f.type, {
                  onServiceAndNameLocator(sn) {
                    if (sn.serviceId === CORE_SERVICE_ID) complex = false;
                    // TODO: (QP-2264) support more than core scalars and product types in fields.
                    return sn;
                  }
                });

                if (!f.name) return;

                if (complex) {
                  resolveFields.push(`${f.name} { id }`);
                } else {
                  resolveFields.push(f.name);
                }
              });
              return pt;
            }
          });

          data = await loadManagedTypeData(
            func,
            `{ ${resolveFields.join(" ")} }`
          );
        }
      } catch (e) {
        logException(
          addLogMessage,
          e,
          `Failed to query data for Kind ${k.name}. Skipping the data export.`
        );
      }

      // Process the kind
      kindsToExport.push({
        ...omit(k, "isDeleted"),
        service: await getServiceInformation(k.service, serviceMap),
        data
      });
    }
    addLogMessage(`Exporting ${kindsToExport.length} Kinds.`);

    addLogMessage("Prepping Functions for export.");
    // Gather the workspace functions that are not boilerplate for export.
    let functionsToExport: FunctionExport[] = [];
    for (const f of funcs) {
      addLogMessage(`Collecting data for Function ${f.name} (${f.id})`);

      let saveGraph: GraphExport | undefined;
      if (f.implementation && !isEmpty(f.implementation.nodes)) {
        const graph = f.implementation;
        saveGraph = {
          zoom: graph.zoom,
          offset: graph.offset,
          nodes: graph.nodes.map(n => ({
            ...n,
            entityIdentifier:
              n.type === NodeType.ARGUMENT ? null : n.entityIdentifier
          })),
          connections: graph.connections.map(c => ({
            id: c.id,
            from: prepareGraphRefForExport(c.from),
            to: prepareGraphRefForExport(c.to)
          }))
        };
      }

      // Process the function
      functionsToExport.push({
        ...omit(f, "isDeleted"),
        service: await getServiceInformation(f.service, serviceMap),
        graph: saveGraph
      });
    }
    addLogMessage(`Exporting ${functionsToExport.length} Functions.`);

    // Gather the information about the knowledge graphs to be exported
    addLogMessage("Loading and Prepping Knowledge Graphs for export.");
    const kgs = await workspace.getKnowledgeGraphs();
    const knowledgeGraphs: KnowledgeGraphExport[] = [];
    for (const kg of kgs) {
      addLogMessage(
        `Collecting data for Knowledge Graph ${kg.name} (${kg.id})`
      );
      knowledgeGraphs.push({
        ...pick(kg, ["id", "name", "nameDescriptor", "description"]),
        graph: {
          offset: kg.graph.offset,
          zoom: kg.graph.zoom,
          nodes: kg.graph.nodes,
          connections: []
        }
      });
    }
    addLogMessage(`Exporting ${knowledgeGraphs.length} Knowledge Graphs`);

    // TODO: (QP-2264) What to do about connections to model types and functions...

    // Return the results
    return {
      version: EXPORT_FILE_VERSION,
      id: workspace.id,
      serviceId,
      persistenceServiceId: workspace.persistenceServiceId,
      name,
      types: kindsToExport,
      functions: functionsToExport,
      services: services.map(s => omit(s, ["kinds", "functions"])),
      assistants,
      lambda: lambdaToExport,
      knowledgeGraphs
    };
  } catch (e) {
    addLogMessage(`Failed to export the workspace: ${e.message}`, true);
    console.log("Failed to fetch workspace", e);
  } finally {
    AssistantAPIClient.setAssistantState(AssistantState.IDLE);
  }

  return null;
}
