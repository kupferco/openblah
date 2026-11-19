import { registerRootComponent } from "expo";
import { registerOpenBlahGlobals } from "@openblah/react-native";
import App from "./src/App";

// Must run before anything else uses LiveKit.
registerOpenBlahGlobals();
registerRootComponent(App);
