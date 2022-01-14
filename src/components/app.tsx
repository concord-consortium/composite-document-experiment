import React from "react";
import { Diagram } from "./diagram/diagram";

import "./app.scss";
import { getSnapshot } from "mobx-state-tree";
import { CDocument } from "../models/c-document";
import { ItemList } from "./item-list/item-list";

const url = new URL(window.location.href);

const loadInitialState = () => {
  const urlDocument = url.searchParams.get("document");
  
  // Default diagram
  let document = {
    sharedModel: {
      id: "1",
      allItems: {
        "1": {
          id: "1",
          name: "A"
        },
        "2": {
          id: "2",
          name: "B"
        },
        "3": {
          id: "3",
          name: "C"
        }  
      }
    },
    diagram: {
      sharedModel: "1",
      nodes: {
        "1": {
            id: "1",
            sharedItem: "1",
            x: 100,
            y: 100       
        },
        "2": {
            id: "2",
            sharedItem: "2",
            x: 100,
            y: 200
        },
        "3": {
            id: "3",
            sharedItem: "3",
            x: 250,
            y: 150
        }
      }
    },
    itemList: {
      sharedModel: "1",
      allItems: [
        {
          id: "1",
          sharedItem: "1"
        },
        {
          id: "2",
          sharedItem: "2"
        },
        {
          id: "3",
          sharedItem: "3"
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

const cDocument = CDocument.create(loadInitialState());

// For debugging
(window as any).cDocument = cDocument;
(window as any).getSnapshot = getSnapshot;


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
      <Diagram dqRoot={cDocument.diagram} />
      <ItemList itemList={cDocument.itemList} />
    </div>
  );
};
