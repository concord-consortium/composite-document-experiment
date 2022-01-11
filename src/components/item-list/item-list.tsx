import { observer } from "mobx-react-lite";
import { Instance } from "mobx-state-tree";
import React from "react";

import { Items } from "../../models/items/items";

interface IProps {
  items: Instance<typeof Items>;
}

// FIXME: instead of directly passing in the items here,
// there should be an item list model that has a way to reference the 
// items shared data model
// this way multiple items shared data models can be supported in the same
// document
export const _ItemList: React.FC<IProps> = ({items}) => {
  // TODO: figure out how to handle selection with the sync'd tree approach
  // const [selectedNode, setSelectedNode] = useState<Instance<typeof DQNode> | undefined>();

  const itemValues = Array.from(items.allItems.values());

  return (
    <div className="item-list" >
      { itemValues.map( item => 
          item ? <div key={item.id}>{item.name}</div> : null
      ) }
    </div>
  );
};

export const ItemList = observer(_ItemList);
ItemList.displayName = "ItemList";
