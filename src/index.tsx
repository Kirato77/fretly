import { render } from "solid-js/web";
import { App } from "./App";
import "./styles.css";
import { startUpdates } from "./updater";

render(() => <App />, document.getElementById("root")!);
void startUpdates();
