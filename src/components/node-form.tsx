import { observer } from "mobx-react-lite";
import { Instance } from "mobx-state-tree";
import React from "react";
import { DQNode } from "../models/dq-node";

interface IProps {
    node: Instance<typeof DQNode>;
  }
  
const _NodeForm: React.FC<IProps> = ({ node }) => {
  const onNameChange = (evt: any) => {
    if (!evt.target.value) {
      node.setName(undefined);
    } else {
      node.setName(evt.target.value);
    }
  };

  return (
    <div style={{zIndex: 4, position: "absolute"}}>
      <div>
        <label>name:</label>
        <input value={node.name || ""} onChange={onNameChange}/>
      </div>
    </div>
  );
};

export const NodeForm = observer(_NodeForm);
NodeForm.displayName = "NodeForm";
