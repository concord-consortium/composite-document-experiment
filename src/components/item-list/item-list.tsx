import { observer } from "mobx-react-lite";
import { Instance } from "mobx-state-tree";
import React, { useEffect } from "react";
import { Reorder } from "framer-motion";
import { autorun } from "mobx";

import { Items } from "../../models/items/items";
import { ItemList as ItemListModel, ItemListItem } from "../../models/item-list/item-list";

interface IProps {
  itemList: Instance<typeof ItemListModel>;
  items: Instance<typeof Items>;
}

// FIXME: instead of directly passing in the items here,
// the itemList should have a way to reference the items shared data model
// this way multiple items shared data models can be supported in the same
// document. 
// Additionally it then becomes the responsibility of the model to keep
// the two lists in sync
export const _ItemList: React.FC<IProps> = ({itemList, items}) => {
  // TODO: move this to the model
  // TODO: analize performance, does this run when the name changes? We should try to 
  // keep it from running this this case. The goal is just to keep the references in sync
  useEffect(() => {
    const disposer = autorun(() => {
        Array.from(items.allItems.values()).forEach(item => {
          // sync up shared data model items with the tile data of items
          // look for this item in the itemList, if it is not there add it
          const matchingItem = itemList.allItems.find(itemListItem => itemListItem.item.id === item.id);
          if (!matchingItem) {
              const newItem = ItemListItem.create({ id: itemList.getNextId().toString(), item: item.id });
              itemList.addItem(newItem);
          }
        });
    
        // we should also look for items that are present in the itemList but not in items
        // this implies they were deleted from the shared data model, so they should be 
        // deleted from the tile data model too. 
        // However this case can probably be handled by safe references. I think this would
        // allow us to delete the objects referencing the deleted object in the shared
        // data model
      });
    return disposer;    
  }, [itemList, items]);

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
