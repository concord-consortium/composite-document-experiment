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
    items: {
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
      items: "1",
      nodes: {
        "1": {
            id: "1",
            item: "1",
            x: 100,
            y: 100       
        },
        "2": {
            id: "2",
            item: "2",
            x: 100,
            y: 200
        },
        "3": {
            id: "3",
            item: "3",
            x: 250,
            y: 150
        }
      }
    },
    itemList: {
      allItems: [
        {
          id: "1",
          item: "1"
        },
        {
          id: "2",
          item: "2"
        },
        {
          id: "3",
          item: "3"
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
      <Diagram dqRoot={cDocument.diagram} items={cDocument.items}/>
      <ItemList itemList={cDocument.itemList} items={cDocument.items}/>
    </div>
  );
};
