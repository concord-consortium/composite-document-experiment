import { observer } from "mobx-react-lite";
import { getSnapshot, Instance } from "mobx-state-tree";
import React, { useRef, useState } from "react";
import ReactFlow, {  Elements, 
  Controls, ReactFlowProvider } from "react-flow-renderer/nocss";
import { DQRoot } from "../models/dq-root";
import { DQNode } from "../models/dq-node";
import { NodeForm } from "./node-form";
import { QuantityNode } from "./quantity-node";
import { ToolBar } from "./toolbar";

// We use the nocss version of RF so we can manually load
// the CSS. This way we can override it.
// Otherwise RF injects its CSS after our CSS, so we can't
// override it. 
import "react-flow-renderer/dist/style.css";
import "react-flow-renderer/dist/theme-default.css";

// The order matters the diagram css overrides some styles
// from the react-flow css.
import "./diagram.scss";

const url = new URL(window.location.href);

let nextId = 0;
const loadInitialState = () => {
  const urlDiagram = url.searchParams.get("diagram");
  
  // Default diagram
  let diagram = {
    nodes: {
        "1": {
            id: "1",
            name: "A",
            x: 100,
            y: 100       
        },
        "2": {
            id: "2",
            name: "B",
            x: 100,
            y: 200
        },
        "3": {
            id: "3",
            name: "C",
            x: 250,
            y: 150
        }
    }
  };

  // Override default diagram with URL param
  if (urlDiagram) {
    diagram = JSON.parse(urlDiagram);
  }

  // Figure out the nextId
  let maxId = 0;
  for (const idString of Object.keys(diagram.nodes)) {
    const id = parseInt(idString, 10);
    if (id > maxId) maxId = id;
  }
  nextId = maxId + 1;
  return diagram;
};

const dqRoot = DQRoot.create(loadInitialState());

// For debugging
(window as any).dqRoot = dqRoot;
(window as any).getSnapshot = getSnapshot;


const nodeTypes = {
  quantityNode: QuantityNode,
};

export const _Diagram = () => {
  const reactFlowWrapper = useRef<any>(null);
  const [selectedNode, setSelectedNode] = useState<Instance<typeof DQNode> | undefined>();

  const onElementsRemove = (elementsToRemove: Elements) => {
    for(const element of elementsToRemove) {
      console.log(element);
      if ((element as any).target) {
        // Not supported 
      } else {
        // If this is the selected node we need to remove it from the state too
        const nodeToRemove = dqRoot.nodes.get(element.id);
        setSelectedNode((currentNode) => nodeToRemove === currentNode ? undefined : currentNode);
        dqRoot.removeNodeById(element.id);
      }
    }
  };

  const onSelectionChange = (selectedElements: Elements | null) => {
    if (selectedElements?.[0]?.type === "quantityNode" ) {
      setSelectedNode(dqRoot.nodes.get(selectedElements[0].id));
    } else {
      setSelectedNode(undefined);
    }
  };

  const onDragOver = (event: any) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const onDrop = (event: any) => {
    event.preventDefault();

    if (!reactFlowWrapper.current || !dqRoot.rfInstance) {
      return;
    }

    const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = dqRoot.rfInstance.project({
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top,
    });

    const dqNode = DQNode.create({
      id: nextId.toString(),
      name: "new",
      x: position.x,
      y: position.y   
    });
    dqRoot.addNode(dqNode);
    nextId++;
  };

  return (
    <div className="diagram" ref={reactFlowWrapper}>
      <ReactFlowProvider>
        <ReactFlow elements={dqRoot.reactFlowElements} 
          nodeTypes={nodeTypes} 
          onElementsRemove={onElementsRemove}
          onSelectionChange={onSelectionChange}
          onLoad={(rfInstance) => dqRoot.setRfInstance(rfInstance)}
          onDrop={onDrop}
          onDragOver={onDragOver}>
          <Controls />
          { selectedNode && 
            <NodeForm node={selectedNode}/>
          }
          <ToolBar dqRoot={dqRoot}/>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
};

export const Diagram = observer(_Diagram);
Diagram.displayName = "Diagram";
