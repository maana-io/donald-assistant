import { LogFunc } from "../models/common";

/**
 * Handles logging exceptions in an uniform way.
 *
 * @param addLogMessage The function to log the exception to.
 * @param exception The exception to log, or a list of them.
 * @param highLevelMessage An additional message to add after the exceptions are
 * logged.
 */
export function logException(
  addLogMessage: LogFunc,
  exception: Error | Error[],
  highLevelMessage: string
) {
  if (Array.isArray(exception)) {
    exception.forEach(e => addLogMessage(e.message, true));
  } else {
    addLogMessage(exception.message, true);
  }
  addLogMessage(highLevelMessage, true);
}
