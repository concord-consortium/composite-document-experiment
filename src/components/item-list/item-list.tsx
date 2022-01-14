import { observer } from "mobx-react-lite";
import { Instance } from "mobx-state-tree";
import React from "react";
import { Reorder } from "framer-motion";

import { ItemList as ItemListModel } from "../../models/item-list/item-list";

interface IProps {
  itemList: Instance<typeof ItemListModel>;
}

export const _ItemList: React.FC<IProps> = ({itemList}) => {
  // TODO: figure out how to handle selection with the sync'd tree approach
  // const [selectedNode, setSelectedNode] = useState<Instance<typeof DQNode> | undefined>();

  const itemValues = Array.from(itemList.allItems.values());

  return (
    <div className="item-list" >
      <Reorder.Group axis="y" values={itemValues} onReorder={(updatedItems) => itemList.setItems(updatedItems)}>
        { itemValues.map( item => (          
            item ? 
              <Reorder.Item key={item.id} value={item}>
                  {item.name}
              </Reorder.Item>
              : null
        )) }
      </Reorder.Group>
    </div>
  );
};

export const ItemList = observer(_ItemList);
ItemList.displayName = "ItemList";
