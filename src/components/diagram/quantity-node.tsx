import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";
import React from "react";

interface IProps {
  data: any;
  isConnectable: boolean;
}
  
const _QuantityNode: React.FC<IProps> = ({ data, isConnectable }) => {
  // When the node is removed from MST, this component gets
  // re-rendered for some reason, so we check here to make sure we
  // aren't working with a destroyed model
  if (!isAlive(data.node)) {
      return null;
  }

  return (
    <div style={{padding: "10px"}}>
        <div>
            <strong>{data.node.name}</strong>
        </div>
    </div>
  );
};

export const QuantityNode = observer(_QuantityNode);

// Because it is observed we have to set the display name
QuantityNode.displayName = "QuantityNode";
