import {
  EntityIdentifier,
  GraphQLFunctionType,
  GraphRefInputType,
  Maybe,
  NodeType,
  Position,
  ServiceType
} from "@io-maana/q-assistant-client";

export interface ServiceExport {
  id: string;
  name: string;
  endpointUrl: string;
  type?: Maybe<ServiceType>;
}

export interface TypeExport {
  id: string;
  name: string;
  nameDescriptor?: Maybe<string>;
  description?: Maybe<string>;
  service: ServiceExport;
  signature: any;
  isManaged: boolean;
  data?: Record<string, any>[];
}

export interface ArgumentFieldSelectionExport {
  argument: string;
  fieldSelection: string[][];
}

export interface NodeExport {
  id: string;
  description?: Maybe<string>;
  location?: Maybe<Position>;
  isCollapsed: boolean;
  type: NodeType;
  entityIdentifier?: Maybe<EntityIdentifier>;
}

export interface ArgumentRefExport {
  argumentId: string;
  argumentName: string;
}

export interface OperationArgumentRefExport {
  operationId: string;
  argumentId: string;
  argumentName: string;
}

export interface OutputArgumentRefExport {
  operationId: string;
  fieldPath: string[];
  argumentId: string;
}

export interface GraphRefExport {
  graphRefInputType: GraphRefInputType;
  argument?: ArgumentRefExport;
  operationArgument?: OperationArgumentRefExport;
  operationResult?: string;
  outputArgument?: OutputArgumentRefExport;
}

export interface ConnectionExport {
  id: string;
  from: GraphRefExport;
  to: GraphRefExport;
}

export interface GraphExport {
  offset: Position;
  zoom: number;
  nodes: NodeExport[];
  connections: ConnectionExport[];
}

export interface FunctionExport {
  id: string;
  name: string;
  nameDescriptor?: Maybe<string>;
  description?: Maybe<string>;
  service: ServiceExport;
  signature: any;
  typeParameters: string[];
  graphqlFunctionType: GraphQLFunctionType;
  isPure: boolean;
  inputMask?: ArgumentFieldSelectionExport[];
  graph?: GraphExport;
}

export interface LambdaExport {
  id: string;
  name: string;
  serviceId: string;
  runtime: { id: string };
  code: string;
  input: { name: string; kind: string; modifiers: string[] };
  outputKind: string;
  outputModifiers: string[];
  kinds: {
    name: string;
    fields: { name: string; kind: string; modifiers: string[] };
  };
  graphQLOperationType: string;
}

export interface KnowledgeGraphExport {
  id: string;
  name: string;
  nameDescriptor?: string;
  description?: string;
  graph: GraphExport;
}

export interface WorkspaceExport {
  id: string;
  serviceId: string;
  persistenceServiceId: string;
  name: string;
  version: number; // Export file version number
  types: TypeExport[];
  functions: FunctionExport[];
  services: ServiceExport[];
  assistants: ServiceExport[];
  lambda: LambdaExport[];
  knowledgeGraphs: KnowledgeGraphExport[];
}
