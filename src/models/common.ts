import { EntityIdentifier } from "@io-maana/q-assistant-client";

export type LogFunc = (message: string, isError?: boolean) => void;

export type RewriteEntityIdentifier = (
  ei: EntityIdentifier
) => EntityIdentifier;
