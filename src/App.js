import { Route, BrowserRouter as Router, Switch } from "react-router-dom";
import { blue, deepOrange, grey, red } from "@material-ui/core/colors";

import CssBaseline from "@material-ui/core/CssBaseline";
import Main from "./pages/Main";
import React from "react";
import { ThemeProvider } from "@material-ui/styles";
import { createMuiTheme } from "@material-ui/core/styles";

const theme = createMuiTheme({
  palette: {
    type: "dark",
    primary: blue,
    secondary: deepOrange,
    error: {
      light: "#E4AAAA",
      main: red[500],
      dark: "#721111",
      contrastText: grey[50]
    },
    text: {
      primary: grey[50],
      secondary: grey[200],
      disabled: grey[500],
      hint: grey[500]
    },
    divider: "rgba(255, 255, 255, 0.12)",
    action: {
      active: grey[100],
      hoverOpacity: 0.21,
      disabled: grey[700],
      disabledBackground: grey[500]
    },
    background: {
      default: grey[800],
      paper: "#515151"
    }
  },
  typography: {
    fontFamily: "PT Sans, display",
    htmlFontSize: 16
  }
});

const App = () => {
  return (
    <ThemeProvider theme={theme}>
      <React.Fragment>
        <CssBaseline />
        <Router>
          <Switch>
            <Route path="/" component={() => <Main />} />
          </Switch>
        </Router>
      </React.Fragment>
    </ThemeProvider>
  );
};

export default App;
