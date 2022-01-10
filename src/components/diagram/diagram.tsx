import { observer } from "mobx-react-lite";
import { Instance } from "mobx-state-tree";
import React, { useRef, useState } from "react";
import ReactFlow, {  Elements, 
  Controls, ReactFlowProvider } from "react-flow-renderer/nocss";
import { DQRoot } from "../../models/diagram/dq-root";
import { DQNode } from "../../models/diagram/dq-node";
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

const nodeTypes = {
  quantityNode: QuantityNode,
};

interface IProps {
  dqRoot: Instance<typeof DQRoot>;
}

export const _Diagram: React.FC<IProps> = ({dqRoot}) => {
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
      id: dqRoot.getNextId().toString(),
      name: "new",
      x: position.x,
      y: position.y   
    });
    dqRoot.addNode(dqNode);
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
