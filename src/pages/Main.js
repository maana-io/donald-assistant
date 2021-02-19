import {
  Button,
  Checkbox,
  FormControlLabel,
  Typography
} from "@material-ui/core";
import React, { useState } from "react";

import AssistantAPIClient from "@io-maana/q-assistant-client";
import DropzoneComponent from "react-dropzone-component";
import { fs } from "../api/filesystem";
import { exportWorkspace as getWorkspace } from "../api/export";
import { importWorkspace } from "../api/import";
import { makeStyles } from "@material-ui/core/styles";
import { withRouter } from "react-router-dom";

const componentConfig = {
  postUrl: "no-url",
  dropzoneSelector: "body"
};

const ReactDOMServer = require("react-dom/server");

const djsConfig = {
  autoProcessQueue: false,
  clickable: ["#importBtn"],
  acceptedFiles: ["application/json"],
  previewTemplate: ReactDOMServer.renderToStaticMarkup(
    <div className="dz-preview dz-file-preview"></div>
  )
};

const useStyles = makeStyles(theme => ({
  root: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    overflow: "hidden",
    height: "100%",
    padding: theme.spacing()
  },
  actions: { display: "flex", flex: "0 0 auto", flexDirection: "row" },
  exportDiv: {
    display: "flex",
    flex: "0 0 auto",
    flexDirection: "column",
    flexBasis: "50%"
  },
  importDiv: {
    display: "flex",
    flex: "0 0 auto",
    flexDirection: "column",
    flexBasis: "50%"
  },
  logDiv: {
    overflow: "auto",
    height: "100%",
    width: "100%",
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column"
  },
  button: {
    minWidth: "200px",
    maxWidth: "200px"
  }
}));

const Main = () => {
  const classes = useStyles();
  const [pending, setPending] = useState(false);
  const [logMessages, setLogMessages] = useState([]);
  const [exportKindData, setExportKindData] = useState(true);

  const addLogMessage = (message, isError = false) => {
    if (isError) {
      console.error(message);
    } else {
      console.log(message);
    }
    setLogMessages(lms => [{ message, isError }].concat(lms));
  };

  const eventHandlers = {
    error: (file, errorMessage) => {
      setLogMessages([
        {
          message: `Error uploading ${file.name}: ${errorMessage}`,
          isError: true
        }
      ]);
    },
    uploadprogress: (file, percentage, bytesSent) => {
      addLogMessage(
        `Uploading ${file.name}: ${percentage}%, ${bytesSent} bytes`
      );
    },
    addedfile: file => {
      setPending(true);
      setLogMessages([]);
      if (file.type !== "application/json") {
        addLogMessage(
          `Upload canceled ${file.name}. Ensure file type is JSON.`,
          true
        );
        setPending(false);
      } else {
        addLogMessage(`Starting Workspace Import ${file.name}`);
        var reader = new FileReader();
        reader.onloadend = (evt => {
          return async e => {
            try {
              const ws = JSON.parse(e.target.result);
              await importWorkspace(ws, addLogMessage);
            } catch (error) {
              addLogMessage(error, true);
            }
            setPending(false);
          };
        })(file);

        // Read in the image file as a data URL.
        reader.readAsText(file);
      }
    }
  };

  const exportWorkspace = async () => {
    setPending(true);
    setLogMessages([{ message: "Starting Workspace Export", isError: false }]);
    const workspace = await getWorkspace(exportKindData, addLogMessage);
    if (workspace) {
      addLogMessage("Saving export.");
      try {
        const timestamp = new Date().toISOString();
        fs.putFile(
          `${workspace.name}-${timestamp}.q-export.json`,
          JSON.stringify(workspace)
        );
      } catch (e) {
        addLogMessage(
          `Faild to save the export with error: ${e.message}`,
          true
        );
      }
    }
    setPending(false);
  };

  const exportLog = async () => {
    const workspace = await AssistantAPIClient.getWorkspace();
    const timestamp = new Date().toISOString();
    fs.putFile(
      `${workspace.name}-${timestamp}.q-exportLOG.json`,
      JSON.stringify(logMessages)
    );
  };

  return (
    <div className={classes.root}>
      <div className={classes.actions}>
        <div className={classes.exportDiv}>
          <Button
            className={classes.button}
            color="primary"
            variant="contained"
            disabled={pending}
            onClick={() => {
              exportWorkspace();
            }}
          >
            Export Workspace
          </Button>

          <FormControlLabel
            label="Export the data in the Kinds"
            control={
              <Checkbox
                color="primary"
                checked={exportKindData}
                disabled={pending}
                onClick={e => setExportKindData(e.target.checked)}
              />
            }
          />
        </div>

        <div className={classes.importDiv}>
          <Button
            id="importBtn"
            className={classes.button}
            color="primary"
            variant="contained"
            disabled={pending}
          >
            Import Workspace
          </Button>
          <Typography variant="body2">
            To import, drop an exported `*.q-export.json` file anywhere on this
            assistant
          </Typography>
          <DropzoneComponent
            config={componentConfig}
            eventHandlers={eventHandlers}
            djsConfig={djsConfig}
          />
        </div>
      </div>

      <Typography variant="h6">Progress</Typography>
      <div className={classes.logDiv}>
        {logMessages.map((lm, index) => (
          <Typography
            key={index}
            variant="body2"
            color={lm.isError ? "error" : "initial"}
          >
            {lm.message}
          </Typography>
        ))}
      </div>
      <Button
        className={classes.button}
        variant="outlined"
        onClick={() => {
          exportLog();
        }}
      >
        Export Progress Log
      </Button>
    </div>
  );
};

export default withRouter(Main);
