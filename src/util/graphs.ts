import {
  ArgumentRef,
  CreateGraphInput,
  CreateNodeInput,
  GraphRef,
  GraphRefInput,
  GraphRefInputType,
  Maybe,
  NodeType,
  OperationArgumentRef,
  OperationResultRef,
  OutputArgumentRef
} from "@io-maana/q-assistant-client";
import { GraphExport, GraphRefExport, NodeExport } from "../models/export";

import { RewriteEntityIdentifier } from "../models/common";

function instanceOfArgumentRef(ref: any): ref is ArgumentRef {
  return (
    Object.keys(ref).length === 2 &&
    "argumentName" in ref &&
    "argumentId" in ref
  );
}

function instanceOfOperationArgumentRef(ref: any): ref is OperationArgumentRef {
  return (
    Object.keys(ref).length === 3 &&
    "operationId" in ref &&
    "argumentName" in ref &&
    "argumentId" in ref
  );
}

function instanceOfOperationResultRef(ref: any): ref is OperationResultRef {
  return Object.keys(ref).length === 1 && "operationId" in ref;
}

function instanceOfOutputArgumentRef(ref: any): ref is OutputArgumentRef {
  return (
    Object.keys(ref).length === 3 &&
    "operation" in ref &&
    "fieldPath" in ref &&
    "argument" in ref
  );
}

/**
 * Prepares a graph reference to be exported.
 *
 * @param ref The graph reference to prepare for export.
 *
 * @returns The export data for the graph reference.
 */
export function prepareGraphRefForExport(ref: GraphRef): GraphRefExport {
  if (instanceOfOperationArgumentRef(ref)) {
    return {
      graphRefInputType: GraphRefInputType.OPERATION_ARGUMENT,
      operationArgument: {
        operationId: ref.operationId,
        argumentId: ref.argumentId,
        argumentName: ref.argumentName
      }
    };
  } else if (instanceOfOutputArgumentRef(ref)) {
    return {
      graphRefInputType: GraphRefInputType.OUTPUT_ARGUMENT_REF,
      outputArgument: {
        operationId: ref.operation,
        argumentId: ref.argument,
        fieldPath: ref.fieldPath
      }
    };
  } else if (instanceOfArgumentRef(ref)) {
    return {
      graphRefInputType: GraphRefInputType.ARGUMENT,
      argument: {
        argumentId: ref.argumentId,
        argumentName: ref.argumentName
      }
    };
  } else if (instanceOfOperationResultRef(ref)) {
    return {
      graphRefInputType: GraphRefInputType.OPERATION_RESULT,
      operationResult: ref.operationId
    };
  } else {
    return { graphRefInputType: GraphRefInputType.FUNCTION_RESULT };
  }
}

/**
 * Checks to see if the node is a function graph input node.
 *
 * @param node The node to check.
 *
 * @returns True if it is a function graph input node.
 */
export function isFunctionGraphInputNode(node: NodeExport): boolean {
  return node.id.endsWith("INPUT");
}

/**
 * Checks to see if the node is a function graph output node.
 *
 * @param node The node to check.
 *
 * @returns True if it is a function graph output node.
 */
export function isFunctionGraphOutputNode(node: NodeExport): boolean {
  return node.id.endsWith("OUTPUT");
}

function graphRefExportToInput(
  ref: GraphRefExport,
  opMap: Record<string, string>,
  argMap: Record<string, string>
): GraphRefInput {
  return {
    graphRefInputType: ref.graphRefInputType,
    argument:
      ref.argument &&
      (argMap[ref.argument.argumentId] ?? ref.argument.argumentId),
    operationArgument: ref.operationArgument && {
      operation:
        opMap[ref.operationArgument.operationId] ??
        ref.operationArgument.operationId,
      argument:
        argMap[ref.operationArgument.argumentId] ??
        ref.operationArgument.argumentId
    },
    operationResult:
      ref.operationResult &&
      (opMap[ref.operationResult] ?? ref.operationResult),
    outputArgument: ref.outputArgument && {
      // TODO: (QP-2264) Figure out how to deal with output arguments...
      operation:
        opMap[ref.outputArgument.operationId] ?? ref.outputArgument.operationId,
      argument:
        argMap[ref.outputArgument.argumentId] ?? ref.outputArgument.argumentId,
      fieldPath: ref.outputArgument.fieldPath
    }
  };
}

/**
 * Converts a GraphExport object into a CreateGraphInput object for passing to
 * workspace update.
 *
 * @param graph The graph export data.
 * @param newNodeIds The new IDs for the nodes.
 * @param argIdMap The ids for the arguments so that connections can be updated.
 * @param updateEntityIdentifier A function that will update entity identifiers as needed.
 *
 * @returns The new CreateGraphInput object or undefined.
 */
export function graphExportToInput(
  graph: Maybe<GraphExport>,
  newNodeIds: Record<string, string>,
  argIdMap: Record<string, string>, // TODO (QP-2264) Figure out what to actually do here...
  updateEntityIdentifier: RewriteEntityIdentifier
): Maybe<CreateGraphInput> {
  if (!graph) return;

  return {
    offset: graph.offset,
    zoom: graph.zoom,
    nodes: graph.nodes.map(n => {
      const node: CreateNodeInput = {
        id: newNodeIds[n.id],
        description: n.description,
        isCollapsed: n.isCollapsed,
        location: n.location,
        type: n.type
      };

      if (n.entityIdentifier) {
        const newEi = updateEntityIdentifier(n.entityIdentifier);
        switch (n.type) {
          case NodeType.ENTITY:
            node.entity = newEi;
            break;
          case NodeType.OPERATION:
            node.operation = newEi;
            break;
          default: // All other node types don't use the entity identifier.
        }
      }

      return node;
    }),
    connections: graph.connections.map(c => ({
      from: graphRefExportToInput(c.from, newNodeIds, argIdMap),
      to: graphRefExportToInput(c.to, newNodeIds, argIdMap)
    }))
  };
}
