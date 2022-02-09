import React from "react";
import { Diagram } from "./diagram/diagram";

import "./app.scss";
import { getSnapshot } from "mobx-state-tree";
import { ItemList } from "./item-list/item-list";
import { Container } from "../models/container";

const url = new URL(window.location.href);

const loadInitialState = () => {
  const urlDocument = url.searchParams.get("document");
  
  // Default diagram
  let document = {
    sharedModel: {
      id: "sharedModel",
      allItems: {
        "1": {
          id: "1",
          name: "A"
        }
      }
    },
    diagram: {
      id: "diagram",
      sharedModel: {
        id: "sharedModel",
        allItems: {
          "1": {
            id: "1",
            name: "A"
          }
        }  
      },
      nodes: {
        "1": {
            id: "1",
            sharedItem: "1",
            x: 100,
            y: 100       
        }
      }
    },
    itemList: {
      id: "itemList",
      sharedModel: {
        id: "sharedModel",
        allItems: {
          "1": {
            id: "1",
            name: "A"
          }
        }  
      },
      allItems: [
        {
          id: "1",
          sharedItem: "1"
        }
      ]
    }
  };

  // Override default diagram with URL param
  if (urlDocument) {
    document = JSON.parse(urlDocument);
  }

  return document;
};

const initialState = loadInitialState();
const trees = Container({
  initialSharedModel: initialState.sharedModel,
  initialDiagram: initialState.diagram,
  initialItemList: initialState.itemList
});

// For debugging
(window as any).trees = trees;
(window as any).getSnapshot = getSnapshot;

const copyDiagramURL = () => {
    const exportedDocument = getSnapshot(trees.undoStore);
    console.log({exportedDocument});
    url.searchParams.set("document", JSON.stringify(exportedDocument));
    console.log(url.href);
    navigator.clipboard.writeText(url.href);
};

// Next step:
// 
// create 3 independent MST trees:
// 1. diagram state itself, and shared model state that is synced from
//    actual shared model
// 2. item list state itself, and shared model state that is synced from
//    actual shared model
// 3. actual shared model state
//
// Initially these will just try to render the right thing by sync'ing the 3
// data model trees
// without worrying about undo, 
//
// Once this is working, then I'll try to handle undo.
// undo will require a new host component that is tracking the state
// I could work on the host component saving state before supporting undo
// it still isn't clear if this should be state or patches.
export const App = () => {
  return (
    <div className="app">
      <div id="containerMenu">
        <button className="action" onClick={copyDiagramURL}>Copy Diagram URL</button>
      </div>
      <Diagram dqRoot={trees.diagram} />
      <ItemList itemList={trees.itemList} />
    </div>
  );
};
