
import { Instance, getSnapshot } from "mobx-state-tree";
import React from "react";
import { DQRoot } from "../../models/diagram/dq-root";

interface IProps {
    dqRoot: Instance<typeof DQRoot>;
}

export const ToolBar: React.FC<IProps> = ({dqRoot}) => {
    const onDragStart = (event: any) => {
        event.dataTransfer.setData("application/reactflow", "quantity");
        event.dataTransfer.effectAllowed = "move";
    };
    
    // FIXME: this is currently broken it is just generating a URL for the diagram
    // instead of one for the whole document.
    const copyDiagramURL = () => {
        const exportedDiagram = getSnapshot(dqRoot);
        console.log("exportedDiagram", exportedDiagram);
        const url = new URL(window.location.href);
        url.searchParams.set("diagram", JSON.stringify(exportedDiagram));
        console.log(url.href);
        navigator.clipboard.writeText(url.href);
    };
        
    return (
      <div style={{zIndex: 4, position: "absolute", right: 0, top: 0, display: "flex", flexDirection:"column"}} >
        <button className="action" onClick={copyDiagramURL}>Copy Diagram URL</button>
        <div style={{border: "1px", borderStyle: "solid", textAlign: "center"}} onDragStart={(event) => onDragStart(event)} draggable>
           Drag to Add
        </div>
      </div>
    );
};
