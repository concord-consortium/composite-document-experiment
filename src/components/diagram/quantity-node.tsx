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

// In the custom node example memo is used here, but when I 
// used it then the component was updating when it was marked
// as an observer and its model changed. So I'd guess memo
// might get in the way of observer.
// export const QuantityNode = memo(observer(_QuantityNode));

// Also with testing the observer isn't needed for simple changes
// like deleting edges or connecting edges.
// My guess is that Flow re-renders on all changes like this
// as long as the change triggers this re-render we are fine.
//
// But if the model gets changed without a flow re-render 
// then, it doesn't update without the observer
export const QuantityNode = observer(_QuantityNode);

// Because it is observed we have to set the display name
QuantityNode.displayName = "QuantityNode";
