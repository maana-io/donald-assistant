import { saveAs } from "file-saver";

export const fs = {
  putFile: async (path, content) => {
    var blob = new Blob([content], {
      type: "text/plain;charset=utf-8"
    });
    saveAs(blob, path);
  }
};
