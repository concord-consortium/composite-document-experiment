import React from "react";
import { Diagram } from "./diagram";

import "./app.scss";

// Somewhere here I want to:
// create 2 components:
// 1. diagram
// 2. list view
// 
// create 5 MST trees:
// 1. diagram: for storing the positions and reference of boxes in a diagram
// 2. diagram: for storing the synced state from the shared data model
// 3. list view: for storing a checked state of the item in the list view
// 4. list view: for storing the synced state from the shared data model
// 5. shared data model: for storing the shared data model itself
//
// Initially these will just try to render the right thing by sync'ing the 3
// data model trees
// without worrying about undo, I'll still need to figure out how the 
// trees or components can respond to updates. When a new element is added 
// in the data model, the component that didn't add it will have to get
// notified and update itself.
//
// Once this is working, then I'll try to handle undo.
// undo will require a new host component that is tracking the state
// I could work on the host component saving state before supporting undo
// it still isn't clear if this should be state or patches.
export const App = () => {
  return (
    <div className="app">
      <Diagram />
    </div>
  );
};
