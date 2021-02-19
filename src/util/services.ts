import AssistantAPIClient, {
  Assistant,
  Service,
  Workspace
} from "@io-maana/q-assistant-client";

import { LogFunc } from "../models/common";
import { ServiceExport } from "../models/export";
import { logException } from "./logging";

/**
 * Converts a service or assistant object from the assistant api to be the
 * information that should be exported.
 *
 * @param service The service or assistant to convert
 *
 * @returns The service export information
 */
export function serviceToExport(service: Service | Assistant): ServiceExport {
  return {
    id: service.id,
    name: service.name,
    endpointUrl: service.location.url,
    type: "type" in service ? service.type : undefined
  };
}

/**
 * Loads missing information about a service for export.
 *
 * @param service Some information about the service, at minimum the ID.
 * @param serviceMap A map of services with their information already loaded.
 *
 * @returns The service information.
 */
export async function getServiceInformation(
  service: { id: string },
  serviceMap: Record<string, ServiceExport>
): Promise<ServiceExport> {
  // If there is no service to get information for, then return null.  This is
  // needed for system level kinds.
  if (!service) return null;

  // If the information is in the map, then just return it
  let serviceInfo = serviceMap[service.id];
  if (serviceInfo) return serviceInfo;

  const fullService = await AssistantAPIClient.getServiceById(service.id);

  // If all else fails, return save the service to the map and return it.
  const servRef = serviceToExport(fullService);
  serviceMap[service.id] = servRef;
  return servRef;
}

/**
 * Imports a list of services into the workspace.
 *
 * @param services The list of services to import.
 * @param currentWorkspace The workspace to import them into.
 * @param addLogMessage Where to log issues.
 *
 * @returns The list of services on the current workspace.
 */
export async function importServices(
  services: ServiceExport[],
  currentWorkspace: Workspace,
  addLogMessage: LogFunc
): Promise<Service[]> {
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
