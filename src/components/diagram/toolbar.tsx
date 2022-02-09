
import { Instance } from "mobx-state-tree";
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
    
    return (
      <div style={{zIndex: 4, position: "absolute", right: 5, top: 5, display: "flex", flexDirection:"column"}} >
        <div style={{border: "1px", borderStyle: "solid", textAlign: "center"}} onDragStart={(event) => onDragStart(event)} draggable>
           Drag to Add
        </div>
      </div>
    );
};
